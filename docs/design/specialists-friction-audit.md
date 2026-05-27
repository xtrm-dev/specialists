# Specialists Runtime — Critica Architetturale, Audit di Attrito e Roadmap di Patch Allineata al Substrate

> **Ruolo del documento.** Fonte di verità canonica e consolidata per la pulizia di specialists-runtime e lo sforzo di allineamento al substrate. Assorbe e sostituisce i documenti precedentemente separati `specialists-runtime-critique.md` (inquadramento architetturale) e `specialists-substrate-alignment.md` (opportunità di ponte rev-9). Il catalogo di attrito, i livelli di patch, le modalità di errore del revisore e il riferimento ai meccanismi hanno avuto origine qui e sono stati rifattorizzati in un'unica roadmap.
>
> **Consumatori previsti.** Operatore (decision-making), sessione di pianificazione (la prossima sessione produrrà un piano di lavoro a fasi da questo documento), implementatore (dopo l'approvazione del piano).
>
> **Metodo.** Lettura diretta di `.xtrm/reports/2026-05-25..26` attraverso i repository mercury market-data, gitboard e specialists; lettura diretta di `src/specialist/{chain-identity,supervisor,runner,worktree,control}.ts` + `src/cli/{run,finalize}.ts`; riferimento incrociato con `docs/design/substrate.md` revisione 9 e `docs/design/channels.md`.
>
> **Disciplina dello scope.** Questo documento è un *piano d'azione per il runtime specialists esistente*, non design (il design risiede in `substrate.md` + `substrate-review.md`). Ogni patch proposta qui deve (a) ridurre attrito concreto ora, (b) sopravvivere all'arrivo del substrate senza rilavorazione, o (c) essere un onesto ponte temporaneo il cui costo è giustificato dall'attrito-che-rimuove-ora.

## Indice

| § | Sezione |
|---|---|
| 1 | Inquadramento architetturale — sei asimmetrie, modello mentale chain≡molecule, risoluzione rev-9 |
| 2 | Catalogo di attrito con evidenza |
| 3 | Roadmap di patch allineata al substrate (le 10 opportunità, arricchite con riutilizzo primitive bd) |
| 4 | Livello ortogonale A — Hook Claude Code su `bd create` |
| 5 | Livello ortogonale B — Hint sp-runtime + `sp chain review` + igiene sp ps |
| 6 | Livello ortogonale C — Skill di bootstrap config per repository |
| 7 | Modalità di errore specifiche del revisore (R1–R8) sotto semantica `--chain` |
| 8 | Audit di riutilizzo + mappa ponte verso il substrate-future |
| 9 | Riferimento ai meccanismi — `sp finalize` e `--force-stale-base` |
| 10 | Rollout sequenziale master — unificato attraverso §3 / §4 / §5 / §6 |
| 11 | Registro decisioni (tutte le domande aperte ora risolte — D1–D23) + aggiunta `recommended_template` al planner (§11.4) |
| 12 | Strategia di decorazione `sp epic` (mappata da explorer, lista deprecati, keeper) |
| 13 | Template di chain concretizzati — 13 file `bd formula` basati su evidenza (sei archetipi + deliberativi/manutenzione) |

---

## 1. Inquadramento architetturale — sei asimmetrie, modello mentale chain≡molecule, risoluzione rev-9

### 1.1 L'errore di forma in una frase

L'attuale runtime specialists tratta i *job* come entità di prima classe e le *chain* come proiezione derivata sul grafo dei job. Il modello a container del substrate inverte questo rapporto: i container sono di prima classe, i job (partecipanti) sono tenant dei container. Sei asimmetrie concrete derivano da questa inversione, ciascuna radicata nel codice oggi e ciascuna risolta da una sezione specifica della revisione 9 del substrate.

### 1.1.1 Il modello mentale chain ≡ bd molecule (la realtà di oggi)

L'identità di una chain è una **molecule** bd — `bd mol pour <formula>` crea un genitore `issue_type=molecule` (la chain) con un bead figlio per ogni step della formula (archi `parent-child`; archi `blocks` tra sibling per `needs`). Un **epic** è il *genitore organizzativo sopra le chain* — il raggruppamento ampio (`--type=epic` + `--parent`) che contiene multiple chain-molecule per un singolo PRD/iniziativa.

Annidamento a tre livelli (epic in cima → chain-molecule → step beads):

```
unitai-xxx (epic, organizational grouping — one PRD/initiative)
│
├── unitai-xxx.1 (molecule, chain identity — created by `bd mol pour code-standard`)
│   ├── unitai-xxx.1.1 (task, ROOT child of molecule: change-contract — problem/scope/non_goals/validation/acceptance)
│   ├── unitai-xxx.1.2 (task, STEP child: code-sanity, label `edge:validates->root`)
│   ├── unitai-xxx.1.3 (task, STEP child: reviewer, label `edge:validates->root`, `needs: [code-sanity]`)
│   └── unitai-xxx.1.4 (task, STEP child: explorer, label `edge:informs->root`)
│
├── unitai-xxx.2 (molecule, another chain for another root)
│   └── … (root + step children)
│
└── …
```

bd permette questo annidamento (verificato fino a 3 livelli: epic → molecule → step). Il soft-warn per annidamento container del substrate a profondità 2 (§14 #3) mappa alla stessa disciplina — epic→molecule→step è normale; annidamento più profondo richiede revisione della decomposizione.

**Variante quick-chain** (nessun epic organizzativo): molecola nuda `unitai-yyy` → figlio root `.1` → figli step `.2`/`.3`. Annidamento a due livelli, comune.

**Ultra-quick single-shot** (nessuna chain): solo un task bead, nessuna struttura molecule/epic. Dispatch via `sp run --bead X` solo per READ_ONLY; gli specialist con capacità di scrittura richiedono una chain (§3.10).

**Mappatura migrazione al substrate (rename meccanico quando rev-9 arriva):**

| Oggi (bd) | Domani (substrate) |
|---|---|
| `unitai-xxx` epic organizzativo | container `kind: epic` (container ampio) |
| `unitai-xxx.1` chain-molecule | container `kind: chain` (container chain per-root) |
| figlio root della molecola | issue root del substrate |
| step children della molecule | problemi step del substrate (step-contracts, relazioni parent-child/`validates` pre-popolano la relazione step per §6.9.2) |
| rendering `bd dep tree` | `sb container ps <id> --tree` |

Il modello bd-molecule-as-chain-identity è **il ponte**. Progettiamo il runtime attorno a `--chain <molecule-id>` oggi, e il modello a container del substrate lo assorbe senza ristrutturazione. Vedi §13.3 per i dettagli dello schema verificato.

### 1.2 Le sei asimmetrie (verificate nel codice)

**Asimmetria 1 — L'executor è il bootstrapper privilegiato della chain.** `src/specialist/chain-identity.ts:38–39`:

```ts
const chainRootJobId = status.chain_root_job_id
  ?? status.worktree_owner_job_id
  ?? status.id;
const chainId = status.chain_id ?? chainRootJobId;
```

L'id della chain defaulta al job id del worktree-owner, che defaulta all'id del job stesso. Nessuna tabella `chains`; la chain viene calcolata risalendo al job proprietario del worktree, in pratica il primo specialist dispatchato con `--worktree` (per convenzione l'executor). Il gotcha di CLAUDE.md *"--worktree and --job are mutually exclusive"* è la superficie operator-facing di questo: solo il primo dispatch può portare `--worktree`; tutti i successivi usano `--job <first-job>` per entrare nel workspace. Uccidere l'executor distrugge implicitamente la chain; un ruolo non-executor (debugger, planner) che voglia *aprire* un worktree fresco deve assumere il ruolo di bootstrapper.

**Asimmetria 2 — Il worktree è posseduto da un job, non dalla chain.** Il worktree viene creato durante il primo `sp run --worktree`; l'id del job proprietario viene stampato sul worktree tramite `worktree_owner_job_id`. Quando il job termina, il worktree *non* viene distrutto ma non è più posseduto da alcuna entità viva. I specialist futuri si uniscono tramite `--job <owner>`, anche dopo che la sessione pi dell'owner è passata in `waiting` (keep-alive) — ecco perché il keep-alive deve tenere l'owner in vita. Conseguenza osservata: worktree orfani di sessioni precedenti fanno scattare il guard stale-base, producendo la normalizzazione `--force-stale-base` (mercury 2026-05-25).

**Asimmetria 3 — La chain non ha una row entity first-class.** Nessuna tabella `chains`. `chain_id` è una colonna sui job (`chain_id`, `chain_root_job_id`, `chain_root_bead_id` in chain-identity.ts:9–11). La chain viene ricostruita aggregando i job che condividono `chain_id`. Query come `listEpicChainsWithLatestJob` camminano la tabella job e proiettano viste chain. Non c'è un posto dove attachare state a livello di chain — workflow risolto, scrutiny, collision matrix, budget, evidence index. L'audit §3.4 (`sp chain <bead>`) è esattamente il gap creato da questa asimmetria.

**Asimmetria 4 — Paradosso del keep-alive: la sessione pi tenuta in vita perché il workspace non ha altro handle di persistenza.** `--keep-alive` fa sì che la sessione pi del primo specialist resti in `waiting` dopo `agent_end` (supervisor.ts:1658+1974) così specialist successivi possono fare `--job <owner>` nello stesso workspace. Il keep-alive sta pagando per **l'handle del workspace**, non per il riuso dello stato LLM. Una semplice chain di reviewer che non ha bisogno di resumability dell'executor tiene comunque la sessione pi dell'executor in memoria finché `sp finalize` la rilascia (operator-dimentica-finalize = resource leak).

**Asimmetria 5 — `--bead` conflatisce work-contract con chain-key.** `sp run <role> --bead <id>` passa il bead in due ruoli: (a) **contract** — cosa fare, criteri di successo, input del prompt; (b) **identity key** — `chain_root_bead_id` viene impostato da questo bead. La SKILL Rule 7 forza poi un *secondo* bead per reviewer/code-sanity (tracking-bead), così la chain finisce con due bead: target + tracking. La conflazione è strutturale: produce l'attrito R4 (l'operatore confonde il tracking-bead con il target).

**Asimmetria 6 — Reviewer-as-parasite: non può esistere senza executor.** Il reviewer deve essere dispatchato con `--job <exec-job>` per entrare nel workspace dell'executor. Senza questo, il reviewer gira in un checkout pulito e non vede nessun diff (R1). Il runtime codifica strutturalmente "reviewer is a follower of executor." Un caso d'uso `security-audit-only` (revisionare codice preesistente, revisionare una patch applicata manualmente, revisionare una PR da fuori il flusso sp) non ha posto nel modello attuale. Code-sanity, security-auditor, obligations-scanner condividono questa forma parassitaria.

### 1.3 Come la revisione 9 del substrate risolve ciascuna

Le sezioni chain-templates / step-issues / worktree-lease di Rev-9 rispondono direttamente a tutte e sei. Mappatura:

| Asimmetria | Risposta Rev-9 |
|---|---|
| 1 — Executor come bootstrapper della chain | §6.9.5 la composizione della chain è uno step esplicito (`sb chain review` / `approve`); il primo dispatch è guidato dal daemon a partire dalla shape risolta. L'executor è uno step tra gli altri — nessun potere speciale. I verbi ponte in sp sono `sp chain review/approve/insert` (1:1 con il substrate). |
| 2 — Worktree posseduto dal job | §6.9.6 **lease** del worktree — posseduto dal container, acquisito da writer-step, rilasciato a quiescence. |
| 3 — La chain non ha una row entity | §6.9.2 shape risolta persistita sul container come contract durevole; §13.3 rows. |
| 4 — Paradosso del keep-alive | §6.9.6 il lease si rilascia su `agent_end` (quiescence pi per §19) — il keep-alive pi si disaccoppia dalla persistenza del workspace. |
| 5 — `--bead` conflatisce contract+key | §6.9.2 contract duale: la root porta il **change-contract** (5 sezioni); lo step porta lo **step-contract** (mandate/inputs/outputs/scope/non_goals). Shape diverse per cose diverse. |
| 6 — Reviewer-as-parasite | §6.9.6 gli step read-only **non acquisiscono** il lease; possono coesistere con un writer o girare da soli. |

Queste risoluzioni sono il target. La roadmap di patch in §3 porta sp incrementalmente verso questa forma senza aspettare il substrate.

### 1.4 Cosa significa "completo" per questo consolidamento

Il consolidamento è completo quando:
1. Ogni attrito osservato (§2) ha almeno una patch nella roadmap che lo affronta.
2. Ogni asimmetria architetturale (§1.2) ha almeno una patch che la ritira prima che il substrate arrivi.
3. Ogni patch dichiara quale sezione substrate-future legge in avanti (così non costruiamo ponti throwaway).
4. Il rollout master (§10) è sequenziato per leverage-per-day, non per comodità di categoria.
5. Le domande aperte (§11) consolidano ogni superficie "l'operatore deve decidere prima di procedere" dai tre documenti precedenti.

---

## 2. Catalogo attriti con evidenza

Quattro categorie, ordinate per costo osservato (frequenza × tempo-di-recupero).

### 2.A Bootstrap repo / rottura dirty-state

Il più costoso e più ripetibile. Ogni sessione multi-bd-op colpisce A1; ogni sessione multi-worktree colpisce A4.

| Tag | Attrito | Evidenza | Costo di recupero quando colpisce |
|---|---|---|---|
| **A1** | L'auto-export di `bd` per-scrittura tiene `.beads/issues.jsonl` staged; `git checkout/reset/merge` abortisce mid-orchestration ("would overwrite changes"); `sp merge` riporta conflitti fantasma | specialists 2026-05-26 Summary; gitboard 2026-05-26 riga 93 ("Pattern: dirty `.beads/issues.jsonl` in index from auto-export race", ricorso 5×) | Recupero manuale di multi-minuti + rischio che `git reset --hard` cancelli lavoro non committato |
| **A2** | `bd hooks install` silently no-ops quando `core.hooksPath` è impostato OPPURE quando un pre-commit non-bd è già al path target; l'operatore pensa che gli hook siano installati ma non lo sono | specialists 2026-05-26 Problems #4–5; memoria `bd-hooks-install-silently-no-ops-in-two-cases` | A1 poi ricorre invisibilmente |
| **A3** | 8 repo con stato bd-dolt rotto dove `bd config get/set` e `bd doctor` rifiutano; la recipe di fix auto-export non può essere applicata automaticamente | specialists 2026-05-26 §"Open Issues operator-attention items"; affected: barchart-scraper, beads_viewer, omni-search-engine, transcriptoz, vaultctl, zsh-starship-config, market-data-uuj | Edit YAML manuale per-repo; il fix si attiva solo dopo che l'operatore ripara Dolt |
| **A4** | Worktree orfani preesistenti da sessioni precedenti fanno scattare il guard stale-base; l'operatore è costretto a `--force-stale-base` ripetutamente anche quando il lavoro È su master | mercury 2026-05-25 riga 97 (6 worktree orfani); stessa riga 80 (`--force-stale-base` usato per TUTTI i dispatch quella sessione) | Ore di rumore `--force-stale-base`; rischio di bypassare staleness reale |
| **A5** | `vitest` / `pytest` raccolgono file di test duplicati da `.worktrees/` durante le esecuzioni da repo-root | gitboard 2026-05-26 §Code Changes (patch `vitest.config.ts` exclude `.worktrees/`) | Fallimenti di test misteriosi che non si riproducono in checkout pulito |
| **A6** | Hook pre-push di terze parti (`osv-scanner`) crashano dentro i worktree; `git push --delete` bloccato da `.beads/export-state.json` end-of-file-fixer | mercury 2026-05-25 riga 84; memoria `specialist-worktree-cleanup-workarounds-mercury-market-data` | L'operatore memorizza workaround per-repo `SKIP=osv-scanner` / `gh api -X DELETE` |
### 2.B Pigrizia dell'orchestratore

Ciò che insegna il SKILL.md rispetto a ciò che fa realmente l'orchestratore. Confermato rispetto a `using-specialists-v3/SKILL.md` v3.5 §"Orchestration Discipline (Paranoid Mode)" eppure la pigrizia persiste.

| Tag | Attrito | Evidenza | Cosa dice SKILL.md |
|---|---|---|---|
| **B1** | Reviewer saltato su diff "piccolo" | gitboard 2026-05-26 riga 32 / riga 92 (".66 one-char fix... reviewer saltato intenzionalmente") | "i diff piccoli nascondono le peggiori regressioni... escalate sempre prima di saltare" |
| **B2** | Explorer / methodologist saltato su lavoro ad alto impatto HIGH quando "causa nota" | mercury 2026-05-25 ondata 4 (`lb9s`: impatto HIGH, "saltato explorer + methodologist (causa nota, forma della fix chiara)") | "Quando incerti, preferire passaggi extra di explorer/debugger" |
| **B3** | L'orchestratore non esegue `specialists list --full` all'inizio di task sostanziali, ricade su ruoli ricordati | Inferito — nessuna invocazione esplicita di `specialists list --full` nelle sezioni di problemi di dispatch | "OBBLIGATORIO — Eseguire al caricamento dello skill e prima di ogni nuovo task sostanziale o epic" |
| **B4** | L'orchestratore inventa flag che non esistono | gitboard 2026-05-26 riga 92: `sp finalize 77cfe7 --skip-review` (flag inesistente) | "Non fare affidamento su flag ricordati obsoleti quando l'help è disponibile" |
| **B5** | `--force-stale-base` usato come valvola di fuga predefinita invece di pulire lo stato | mercury 2026-05-25 riga 80 ("Usato stesso flag per tutti i dispatch successivi di questa sessione") | La memoria `git-state-precondition-for-chain-dispatch-orchestrator-must` dice di verificare PRIMA lo stato pulito |
| **B6** | L'orchestratore modifica a mano file marcati "gestiti dal tooling, mai a mano" | specialists 2026-05-26 riga 114 (modifiche a mano del mirror `.specialists/default/` in 15 repo) | "Non modificare mai `.specialists/default/` a mano — è gestito da `update-specialists`" |
| **B7** | L'executor usa `--no-verify` e include file non correlati nel commit | mercury 2026-05-25 riga 81 (`7egg` executor: bypass --no-verify + stale-base + commit a scope misto intitolato "(#155)") | Implicito — nessun testo SKILL copre questo direttamente |

### 2.C Dispatch su diff sbagliato / cwd sbagliato

Questi causano vera perdita di dati o review silenziosamente errate. Frequenza inferiore, gravità superiore.

| Tag | Attrito | Evidenza | Gravità |
|---|---|---|---|
| **C1** | Persistenza cwd dell'orchestratore tra chiamate Bash — `cd <worktree>` lascia i comandi successivi dentro quel worktree; `git reset --hard origin/main` allora azzera il ref del branch dell'executor | gitboard 2026-05-26 riga 94 ("ha silenziosamente resettato il ref del branch executor all'HEAD di main, cancellando i commit dell'executor") | **CRITICO** — recupero solo via reflog |
| **C2** | Chain dispatchata su base obsoleta quando la chain fratello precedente non è mergiata → loop debugger-restitch garantito | Memoria `git-state-precondition-for-chain-dispatch-orchestrator-must`; gotchas di CLAUDE.md | ALTO — spreca l'intera chain |
| **C3** | Reviewer dispatchato senza `--job <exec-job>` perde il contesto del workspace, review su diff sbagliato | SKILL §Regola Non-Negoziabile 7 (implica che questo è successo) | ALTO — verdetto silenziosamente errato |
| **C4** | Campo `VALIDATION` del bead più ristretto dello scope dei test del pre-commit → fallimenti a sorpresa da test di baseline-encoding non correlati | mercury 2026-05-25 riga 94; `7egg` aveva 5 regressioni baseline in `test_treasury_conversion.py` fuori dal file di test nominato nel bead | MEDIO — risolvibile a metà chain via resume executor |

### 2.D Lacune di visibilità (stato silenzioso, successo muto)

L'orchestratore non può essere meno pigro se il sistema non gli dice cosa è appena successo.

| Tag | Attrito | Evidenza | Cosa manca |
|---|---|---|---|
| **D1** | Swallow di `SourceQueue.drain` / `getCursor` JSON.parse non catturato → modalità di fallimento silenziose che mascherano cause radice per ore | gitboard 2026-05-26 §forge-eorh.62 ("swallow silenzioso che ha mascherato le cause radice di .58 + .61 per ore") | Eventi di errore sul wire (ora fissato in gitboard, ma il pattern è generale) |
| **D2** | L'executor auto-segnala `tests_pass: false` quando i test passano in realtà; l'orchestratore deve ri-eseguire pytest indipendentemente | mercury 2026-05-25 riga 93 | Step di verifica indipendente prima del dispatch a valle. **Principio (promosso da nota a piè di matrice):** *L'autorità di verifica appartiene a un gate indipendente, mai all'attore verificato.* Applicazione a runtime del substrato §3.1 (avanza solo su evidenza persistente) + §6.9.2 (un gate è `done` solo quando *soddisfatto*). La fix atterra dentro il payload `step_completed` dell'Opportunità 8: il risultato auto-segnalato dall'executor è informativo; la chain avanza sul verdetto persistente del gate (code-sanity / reviewer). |
| **D3** | `sp merge` riporta "Merge conflict" senza info azionabili — l'operatore non sa se è un vero conflitto o stato sporco A1 | gitboard 2026-05-26 riga 93 ("errore 'Merge conflict' anche se git merge-tree mostrava pulito") | Diagnostica nel messaggio di errore |
| **D4** | Il messaggio di successo di `sp run` è minimale — l'operatore non vede modello usato, scrutiny risolto, durata attesa, o "prossimo step raccomandato" | Inferito dall'assenza nei report di pattern "dopo che `sp run` ha mostrato ..." | Un messaggio strutturato di hint post-dispatch |
| **D5** | Dopo `sp result <id>` l'operatore non riceve un "suggerimento prossimo step" basato sul contenuto del risultato (PASS → prossimo gate; PARTIAL → resume executor; FAIL → escalate) | Stesso | Formattatore di risultati consapevole del workflow |
| **D6** | Nessuna superficie che mostri "stato corrente della chain + prossimo dispatch atteso" — l'operatore porta lo stato in testa | SKILL.md cerca di insegnare questo; la realtà è che l'operatore dimentica tra un sonno e l'altro | Un comando `sp chain <bead>` o vista timeline equivalente |
| **D7** | Lo spawn dello specialista auto-inietta `bd prime` + dump di `.xtrm/memory.md` (~3.8k token) indipendentemente dallo scope del task; la maggior parte delle memorie è irrilevante al bead corrente; gli specialisti piccoli (code-sanity, obligations-scanner) pagano una tassa di context sproporzionata | Memorie `bd-prime-context-overhead`, `specialist-runner-injects-xtrm-memory-md-bd-prime` | Pull-not-push: l'agente interroga `bd memories <keyword>` scoped al proprio bead. Si chiude allo stesso modo in cui lo fa il principio knowledge-scope del substrato — le query ricostruiscono la slice. **Opportunità 11 / D27.** |

---

## 3. Roadmap delle patch allineate al substrato (le 10 opportunità)

Questa sezione sostituisce la precedente "Layer 1 runtime patches" della prima revisione dell'audit e incorpora la **scoperta di riconciliazione principale dal passaggio di review rev-9: bd espone già le primitive che stavamo per inventare** (bd merge-slot, bd mol, bd formula, bd swarm). Le opportunità qui sotto favoriscono il riutilizzo di primitive bd rispetto a nuova infrastruttura sp. Il modello mentale è `chain ≡ bd molecule` per §1.1.1 / §13.3 (rifinito dal precedente `chain ≡ bd epic`; epic è il *genitore organizzativo sopra le chain*, molecule è l'identità della chain).

Ciascuna opportunità:

- (a) è implementabile senza il daemon del substrato o la tabella `containers`,
- (b) sopravvive nel mondo rev-9 senza rielaborazione,
- (c) chiude un tag di attrito (§2) e/o rimuove un'asimmetria architetturale (§1.2).

I layer ortogonali — hook Claude Code (§4), hint sp-runtime (§5), bootstrap per-repo (§6) — NON sono opportunità di allineamento; si trovano a layer diversi e sono descritti nelle proprie sezioni.

### 3.0 La scoperta di riconciliazione — inventario delle primitive bd

Quattro primitive bd che ho sottovalutato nel primo passaggio di review supportano direttamente la riprogettazione allineata al substrato. Riutilizzarle evita di inventare nuove tabelle sp, nuovi verbi CLI, nuovo codice daemon.

| primitiva bd | Cosa fornisce | Sostituisce cosa che stavo per costruire |
|---|---|---|
| `bd merge-slot` | Primitiva di accesso esclusivo (holder + coda waiters) — lease con scope chain | Nuove "colonne lease worktree" (Opportunity #1, originale) |
| `bd mol` (proto / pour / wisp / bond / distill) | Istanziazione di work-template con sostituzione variabili | Nuova tabella `chain_shapes` (Opportunity #3, originale) |
| `bd formula` (workflow YAML/JSON con extends + compose) | Linguaggio di definizione template di chain | Nuovo schema YAML per composizione (Opportunity #9, originale); anche nuovo schema di substrate-review §25 |
| `bd swarm` (epic + DAG di children, create/validate/status) | Struttura wave/epic con fronti di lavoro parallelo | Nuovi tipi wave/epic in sp |

Queste sono verificate con `bd <cmd> --help` rispetto alla versione corrente di bd. Le opportunità qui sotto le riutilizzano esplicitamente.

### 3.1 Le undici opportunità — tabella riassuntiva

| # | Patch | primitiva bd riutilizzata | Attrito chiuso | Asimmetria rimossa | Si proietta nel substrato | Costo |
|---|---|---|---|---|---|---|
| **1+2 (fuso)** | **bd merge-slot come lease della chain + binding del percorso workspace READ_ONLY disaccoppiato dalla vitalità del job proprietario; READ_ONLY mantiene keep-alive intra-job per il resume** | `bd merge-slot` | C2 (parziale), D6 (parziale), previene R1/R5, B1+B2 indirettamente | **2 + 4 + 6 (parziale)** | **§6.9.6 semantica lease worktree; lease per-container con passaggi read-only che non acquisiscono** | **2 giorni complessivi** |
| 3 | Persisti la forma risolta della chain via `bd mol pour <formula>` (chain materializzata come molecola versata) | `bd mol`, `bd formula` | D6 | 3 | §6.9.2 forma risolta come stato del container — migrazione mol → container è una ridenominazione meccanica | 1,5 giorni |
| 4 | `sp chain review / approve / insert` — comando di composizione gate che wrappa `bd formula list` + `bd mol pour` + `bd swarm validate`; più modalità single-shot implicita via `sp run --chain X` con auto-creazione. I verbi corrispondono al substrate `sb chain review/approve/insert` 1:1 (nessuna rimappatura in migrazione). | `bd formula`, `bd mol`, `bd swarm` | D4, D6, B1 | 1 | §6.9.5 + §11.1 `sb chain review/approve/insert` (forma del verbo identica) | 2 giorni |
| 5 | Convenzioni per bead degli step: titolo `<role>:<root-id>` (solo suggerimento — l'etichetta `kind:step` è il discriminante autorevole), `--type=task --parent <molecule-id>` obbligatori, cablaggio deterministico role→edge (`validates` / `informs` / `blocks-on` / `discovered-from`) atomicamente con bd create | `--parent` di bd + edge di dipendenza tipizzate | R4, R8, abilita separazione pulita in `bd list` | 5 | §6.9.2 step-issues materializzati con relazione parent come proprietà dell'essere uno step | 1 giorno |
| 6 | Nomi di branch/worktree derivano dalla chain-molecule, non dal ruolo del creatore (`chain/<molecule-id>` invece di `feature/<bead-id>-<role>`) | — | naming parte di (3) | 3 (parziale) | §6.9.7 nomi derivanti dall'appartenenza — `wt/epic-<id>/chain-<id>` estende `chain-<id>` in modo pulito quando le epic acquisiscono base di integrazione | 0,5 giorni |
| 7 | Ridenominazione `--accept-stale-base --reason "<text>"` + envelope di rifiuto strutturato (forma channels.md §10.2); periodo di grazia di 1 release che accetta `--force-stale-base` con avviso di deprecazione | — | B5 | — | §21 gate di precondizione + envelope channels.md §10.2 | 0,5 giorni |
| 8 | Evento `step_completed` con payload `next_step_recommendation` (letto dai metadata mol dell'Opportunità #3) | `bd mol` (per lookup prossimo-step) | D4, D5 | ponte verso "il daemon avanza" | §3 daemon-advances-on-agent_end (stesso payload) | 1 giorno |
| 9 | Regole di composition-nudge espresse nella sintassi `bd formula` (estende il linguaggio esistente; stesso matcher tra `bd formula applies_when` e ogni nuova regola nudge) | `bd formula` | B2 | — | §6.9.5 L1 nudges (un matcher in tutto il sistema) | 1 giorno |
| **10 (NUOVO)** | **Riprogettazione `--chain <molecule-id>`: deprecare `--worktree` e `--job`; dispatch basato su identità della chain con provisioning implicito del worktree per specialisti write-capable + dispatch cwd per single-shot READ_ONLY; write-capable SENZA `--chain` viene RIFIUTATO (chiude l'attuale buco di sicurezza dove il dispatch predefinito su cwd poteva scrivere su master)** | `bd merge-slot` (via #1+#2), `bd --parent` (creazione chain-molecule) | A4, C1, previene R1/R2 interamente | **1 + 2 + 6** | **§6.9.5 + §11.1 superficie di dispatch (1:1 con `sb dispatch`)** | **2 giorni** |
| **11 (NUOVO)** | **Pull-not-push memory recall: eliminare l'iniezione automatica di `bd prime` + `.xtrm/memory.md` allo spawn (~3.8k token irrilevanti per la maggior parte dei task); sostituire con una mandatory rule che insegna allo specialista a interrogare `bd memories <keyword>` / `bd recall <key>` in base al proprio scope** | `bd memories`, `bd recall` (già esistenti) | nuovo: spreco di context (D27 nel ledger; memoria `bd-prime-context-overhead`) | — (allineamento filosofico con substrate) | **substrate knowledge-scope principle ("facts with metadata; queries reconstruct the slice") — il curator al seed start interroga in base allo scope, non pre-carica tutto** | **1 giorno** |

**Totale: ~13 giorni di lavoro concentrato**, ma il riutilizzo delle primitive bd significa che molte opportunità sono thin glue di integrazione (un giorno ciascuna) piuttosto che nuova infrastruttura. Sequenziamento in §10.

### 3.2 Dettaglio per opportunità

#### Opportunità 1+2 (FUSE) — `bd merge-slot` come lease della chain + binding del percorso workspace READ_ONLY disaccoppiato dalla vitalità del job proprietario

**Ora.** Usa `bd merge-slot` (già esistente, primitiva ad accesso esclusivo con holder + coda waiters) come lease del worktree con scope chain. Un merge-slot per chain-molecule; i metadata trasportano il percorso del worktree. Il runtime integra l'acquire/release del merge-slot nel flusso di dispatch.

Flusso di acquire/release:

- **Writer-step (executor, debugger; permission MEDIUM/HIGH)** dispatchato con `--chain <molecule-id>`:
  - Risolvi il merge-slot per la chain-molecule via `bd merge-slot check <molecule-id>` (o lookup equivalente)
  - Slot `free` → `bd merge-slot acquire <molecule-id>` + esegui; release su `agent_end` (supervisor.ts:1658 è l'hook giusto) via `bd merge-slot release <molecule-id>`
  - Slot `held` da un altro job attivo → **accoda** il dispatch (rifiuta con `WAIT: lease held by <job>; queued, will dispatch on release`)
- **Read-only step (permission READ_ONLY)** dispatchato con `--chain <molecule-id>`:
  - Leggi i metadata del merge-slot per ottenere il percorso del worktree; **mai** acquisire lo slot
  - Fai il bind al percorso del worktree sulla sua sessione pi
  - Il job proprietario può essere `done`, `closed`, o kill -9 — lo specialista read-only entra comunque
  - Mantiene il proprio `--keep-alive` per **resume intra-job** (l'operatore può fare `sp resume <read-only-job>` per chiedere chiarimenti di follow-up senza re-dispatch + costo di 20–30k token). Il disaccoppiamento è **solo cross-job liveness**, non resumability intra-job.

**Perché.** Chiude le Asimmetrie **2 + 4 + 6** in una singola integrazione:

- **2 (worktree posseduto dal job):** il worktree ora appartiene al merge-slot (con scope chain), non al job di bootstrap.
- **4 (paradosso keep-alive):** gli specialisti read-only non necessitano più che la sessione pi del proprietario sia attiva per l'handle del workspace. Keep-alive diventa puramente una comodità per il resume intra-job.
- **6 (reviewer-as-parasite):** reviewer/code-sanity/security-auditor/obligations-scanner entrano nel workspace della chain indipendentemente dalla vitalità dell'executor.

**Legge in avanti.** Rev-9 §6.9.6 *è* questo lease, spostato da bd merge-slot (oggi) ai metadata del container substrate (domani). La migrazione è ridenominazione + ricollocazione; nessun cambio semantico. La superficie `--chain` (§3.10) è identica al `sb dispatch --container <id>` di substrate.

**Note di implementazione.**

- Il campo `metadata.worktree_path` di bd merge-slot trasporta la locazione del worktree. sp provisiona il worktree (esistente `provisionWorktree()` in `worktree.ts`) al momento della creazione della chain e scrive il percorso nei metadata dello slot.
- Il meccanismo `bd merge-slot` usa `status=open|in_progress` + `metadata.holder` + `metadata.waiters`; lo stato del lease in sp deriva da questi.
- La migrazione dall'esistente `worktree_owner_job_id` è uno script one-pass: per ogni chain esistente, crea merge-slot, trasferisci ownership.

**Questa è la patch runtime con la massima leva in tutta la roadmap.** Landare per prima.

#### Opportunità 3 — Persisti la forma risolta della chain via `bd mol pour`

**Ora.** Riutilizza `bd mol` (già esistente: template proto/molecule + pour/wisp/bond/distill) per la materializzazione della forma della chain. Un template di chain è un `bd formula` (file workflow YAML/JSON); versare la formula istanzia una molecola reale (un albero di bd issues) che *è* la forma risolta della chain.

Flusso:

1. L'operatore (o `sp chain review`) seleziona un template di chain — uno dei 13 template evidence-backed (§13.1) forniti come file `bd formula` sotto `~/.beads/formulas/` (o per-progetto).
2. `bd mol pour <formula>` crea la chain-molecule (`issue_type=molecule`) + child step-beads secondo le definizioni degli step della formula.
3. La struttura della molecola versata (bead radice + step beads + edge di dipendenza) **è** la forma risolta della chain — nessuna tabella `chain_shapes` separata necessaria.
4. Lo stato per step è letto da `bd show <step-bead>` + stato del job da observability.db (join via specialist_jobs.bead_id).

**Perché.** Chiude l'Asimmetria 3 (nessuna riga di entità). La molecola versata È la riga di entità, espressa come struttura bd. Sblocca `sp chain <molecule-id>` come `bd children` + join observability — stessi dati dell'approccio a nuova tabella ma riutilizza l'infrastruttura bd.

**Legge in avanti.** Rev-9 §6.9.2 "resolved shape persisted as container state" mappa alla molecola versata. Migrazione: bd-mol → substrate-container-with-step-issues è un trasferimento strutturale, nessuna ricomputazione semantica.

**Note di implementazione.**

- I 13 template di chain predefiniti (§13.1: code-quick, code-standard, code-with-advisors, debug, security-deep, release-prep, triage, research-only, restitch, planning, premortem, doc-sync, memory-hygiene) sono forniti come file `bd formula` in `docs/design/chain-templates/`. I primi sei sono gli *archetipi* che substrate §6.9.10 nomina; il resto sono chain deliberative/di manutenzione che il catalogo del runtime aggiunge (substrate §6.9.10 inquadra gli archetipi come un pavimento, il runtime fornisce un catalogo evidence-backed più ampio).
- `bd formula extends` permette a personalizzazioni per-repo di sovrapporsi ai default forniti (es., `quant-validation` di mercury market-data estende `code-with-advisors`).

#### Opportunità 4 — `sp chain review / approve / insert` — comando di composizione gate

**Mappatura verbi (D16 chiuso; allinea 1:1 con substrate §6.9.5 / §11.1).** `review` = mostra la forma risolta (era `plan`). `approve` = eseguila / dispatcha il primo step (era `dispatch`). `insert` = invariato. Substrate usa questi esatti verbi; matching ora rende `sp` → `sb` una ridenominazione binaria in migrazione senza rimappatura di comandi.
**Accettazione argomenti (D17 chiuso).** `sp chain <molecule-id>` accetta **solo l'id della molecola radice**. Un argomento step-bead viene rifiutato con un suggerimento che rimanda alla sua molecola: `STEP BEAD: <id> è uno step della molecola <mol>; intendevi \`sp chain <mol>\`?` (risoluzione tramite l'edge `parent-child` dello step — il cablaggio obbligatorio dell'Opportunità 5 rende questa ricerca deterministica).

**Ora.** Nuova sequenza di comandi che avvolge primitive bd. Due modalità:

**Esplicita (multi-step, revisione prima dell'approvazione):**
```
$ sp chain review unitai-kglvm
Resolved formula: code-standard (matched type=task, scrutiny=medium, scope=production)
Pouring molecule:
  unitai-kglvm.1     (root bead — change-contract for the deliverable)
  unitai-kglvm.2     (step: code-sanity, validates → .1)               [mandatory gate, READ_ONLY]
  unitai-kglvm.3     (step: obligations-scanner, validates → .1)       [mandatory gate, READ_ONLY]
  unitai-kglvm.4     (step: reviewer, validates → .1, blocks-on .2,.3) [scrutiny may auto-escalate]

Created chain-molecule unitai-kglvm with 4 child beads.
Worktree provisioned: .worktrees/chain-unitai-kglvm
Merge-slot acquired by composition session.

Run `sp chain approve unitai-kglvm` to start executor.
Run `sp chain insert unitai-kglvm --role <r> --before <step>` to modify before approval.
```

**Implicita (single-shot ergonomica, `sp run` auto-crea):**
```
$ sp run executor --chain unitai-kglvm --bead unitai-kglvm.1
[chain unitai-kglvm not found — auto-creating via formula `code-standard` (matched type/scrutiny)]
[poured molecule: 4 step beads under molecule unitai-kglvm]
[worktree provisioned: .worktrees/chain-unitai-kglvm  branch: chain/unitai-kglvm]
[merge-slot acquired by job e7a3f1]
Dispatching executor e7a3f1...
```

**Perché.** Chiude l'Asimmetria 1 (executor come bootstrapper). La composizione della chain è un'azione esplicita dell'operatore — *oppure* una derivazione automatica implicita — *prima* che qualsiasi specialist giri in qualsiasi ruolo privilegiato di "chain root". `executor` diventa solo il prossimo step secondo la formula risolta.

**Si legge in avanti.** Rev-9 §6.9.5 + §11.1: `sb chain review` / `approve` / `insert` sono ora nome-identici a `sp chain review` / `approve` / `insert` (D16). La migrazione è una rinomina binaria del prefisso del namespace + inversione del data layer (mol→container), nessuna mappatura per verbo.

**Razionale della denominazione `sp chain`.** Chain è l'unità di ragionamento dell'orchestrator per SKILL §Orchestration Discipline. `--chain <molecule-id>` accetta l'id della chain-molecule (la molecola bd che è l'identità della chain per §13.3). Si collega naturalmente a `sb container ps --container <id>` del substrate.

#### Opportunità 5 — Separare i contratti degli step dai contratti di root in bd, con **cablaggio obbligatorio** dell'edge di root

**Ora.** Convenzione + tooling + **applicazione al momento della creazione** (non modifica allo schema):

- Una **root bead** continua a usare le sezioni del change-contract (`PROBLEM/SCOPE/NON_GOALS/VALIDATION/ACCEPTANCE`).
- Una **step bead** usa un diverso insieme di sezioni: `MANDATE/INPUTS/OUTPUTS/SCOPE/NON_GOALS`. **L'etichetta `kind:step` è il discriminatore autorevole** (substrate §6.9.7: il nome non è la semantica — il tag strutturale lo è). Il pattern del titolo `<role>:<root-id>` (es. `code-sanity:forge-eorh.48`) è solo un suggerimento pratico che l'hook di Claude usa per *proporre* il template dello step-contract al momento di `bd create`; non è **mai** la fonte della decisione step-vs-root dopo che il bead esiste. L'helper post-pour `sp chain wire-edges` legge le **etichette** (`edge:<type>-><target>`), non i titoli, per applicare edge semantici — le formule del catalogo seguono già questa disciplina.
- L'hook di Claude Code su `bd create` (§4) rileva il pattern del titolo e propone il template dello step-contract E **crea atomicamente l'edge corretto verso la root indicata**, rifiutando se l'id di root nel titolo non esiste.
- `sp chain insert <chain-id> --role <r>` (Opportunità 4) crea lo step-bead e l'edge in una transazione — mai come due operazioni che l'operatore potrebbe separare.
- SKILL.md insegna la distinzione; i tracking-bead reviewer/code-sanity esistenti possono essere migrati pigramente man mano che vengono toccati (un `bd dep add` one-time per ogni orfano).

**Il cablaggio dell'edge è obbligatorio, non facoltativo.** Uno step-bead deve essere raggiungibile dalla sua root tramite un edge ben tipizzato nel momento in cui esiste. Il tipo di edge è **deterministico dato il ruolo** — sia l'hook di Claude che `sp chain insert` conoscono il ruolo e la chain e derivano automaticamente l'edge:

| Categoria ruolo | Edge aggiunto alla creazione | Esempio |
|---|---|---|
| Gate (`reviewer`, `code-sanity`, `obligations-scanner`, `security-auditor`) | `validates` → root | `code-sanity:forge-eorh.48 --validates--> forge-eorh.48` |
| Advisor pre-executor (`explorer`, `methodologist`, `researcher`) | `informs` → root | `explorer:forge-eorh.48 --informs--> forge-eorh.48` |
| Ordinamento gate Layer-2 (code-sanity deve precedere reviewer per Iron pipeline) | `blocks-on` → altro step | `reviewer:48 --blocks-on--> code-sanity:48` |
| Follow-up scoperti da uno step | `discovered-from` → step (non root) | `cleanup-followup --discovered-from--> code-sanity:48` |

**Perché.** Chiude l'Asimmetria 5 *strutturalmente*, non solo per convenzione. I bead reviewer smettono di produrre il mal-adattato "problem: do the review" — hanno la forma giusta fin dall'inizio. L'operatore non può più confondere tracking-bead con target-bead perché *appariscono diversi* (sezioni diverse renderizzate) E il tracking-bead è strutturalmente legato alla sua root nel grafo delle dipendenze — `bd dep tree <root>` mostra il layout completo della chain. Elimina interamente i tracking-bead orfani.

**Perché l'obbligatorietà è importante (oltre a R4).** Diverse patch a valle assumono che l'edge esista:

- `sp chain <bead>` (Opportunità 4 / §5.4) può attraversare tramite edge invece di graph-walk sui job — funziona correttamente *prima* che l'Opportunità 3 (forma della chain persistita) arrivi.
- `bd list --status=open` smette di mischiare lavoro di root e tracking-bead — il filtro "ha edge `validates` in entrata" li separa pulitamente; la vista predefinita mostra le root, `--show-steps` rivela gli interni della chain.
- La migrazione del substrate è meccanica: ogni step-bead è già un candidato `class: step` con il suo edge `parent_id`/`validates` pre-popolato; la migrazione è una rinomina di colonna, non una ricostruzione del grafo.
- R8 sotto (il controllo al momento del dispatch) è implementabile a basso costo.

**Si legge in avanti.** Le step-issue di Rev-9 §6.9.2 sono *materializzate* come parte della composizione della chain (§6.9.5) — *nascono con* la loro relazione di root come proprietà dell'essere uno step. Non è possibile avere una "step-issue senza edge di root" nel substrate. L'attuale cablaggio obbligatorio alla creazione produce lo stesso invariant sul data layer di bd; la migrazione è "step-bead con edge `validates` verso root" → "step-issue con `parent_id` verso la root-issue primaria del container root" — una rinomina + re-target, nessun cambio semantico.

#### Opportunità 6 — I nomi di branch/worktree derivano dall'identità della chain
**Ora.** Oggi: branch denominati `feature/<bead-id>-<role>` (ruolo del creatore). Passare a `chain/<bead-id>` per il writer-branch — nessun suffisso di ruolo. Il worktree rispecchia: `.worktrees/chain-<bead-id>`. Se un debugger prende il controllo (post-quiescenza dell'executor secondo Opportunità 1), il nome del branch non cambia — il ruolo-dello-scrittore-corrente si sposta attraverso lo stesso branch.

**Perché.** Chiude parte dell'Asimmetria 3. Interrompe la denominazione sorprendente quando l'identità-del-momento di una catena cambia (executor → debugger).

**Si legge in avanti.** Rev-9 §6.9.7 i nomi sono `wt/epic-<id>/chain-<id>` — estende il nostro `chain-<id>` in modo pulito quando arrivano gli epic. I nomi si arricchiscono man mano che i contenitori si annidano; il livello della catena rimane lo stesso.

#### Opportunità 7 — Ridenominazione `--accept-stale-base --reason` + busta di rifiuto strutturata

**Ora.** Rinominare `--force-stale-base` → `--accept-stale-base --reason "<testo>"`. La motivazione è obbligatoria, registrata negli eventi di osservabilità. La busta di rifiuto acquisisce campi strutturati:

```jsonc
{
  "ok": false,
  "error_code": "stale_base",
  "blocked_by": ["sibling chain feature/forge-eorh.40 unmerged", "..."],
  "next_safe_action": "diagnose | accept | abandon-chain",
  "diagnose_command": "git log --oneline <sibling-branches> ^master"
}
```

L'azione `diagnose` stampa il `git log` che mostrerebbe se il lavoro sibling è equivalente a qualcosa già su master sotto uno SHA diverso (la condizione di over-fire documentata in §9.2).

**Perché.** Chiude B5. La denominazione `--force-` insegnava all'operatore "questo è normale, basta sovrascrivere"; `--accept- --reason` rende la sovrascrittura deliberata e tracciabile nel audit.

**Si legge in avanti.** Rev-9 §21 (violazione di precondizione come gate §6.4) racchiude questo. La busta di rifiuto corrisponde alla forma di channels.md §10.2 usata in tutto il substrate. Il pattern `--accept --reason` sopravvive invariato in `sb dispatch <issue> --allow-unready --reason "..."` di rev-9 §11.2.

**Obiettivo esteso (non bloccante).** Insegnare a `evaluateMergeWorthiness` (run.ts) il rilevamento di equivalenza patch-id — se i commit del sibling sono patch-id-uguali a commit già su master, il guard non si attiva affatto. Questo affronta la causa radice dell'over-fire; senza di esso, la ridenominazione rimane comunque un miglioramento rigoroso.

#### Opportunità 8 — Evento `step_completed` con raccomandazione del passo successivo

**Principio realizzato** (promosso dalla nota della matrice D2): *l'autorità di verifica appartiene a un gate indipendente, mai all'attore verificato.* Il `tests_pass` auto-riportato dall'executor (attrito D2) è solo informativo; il payload dell'evento `step_completed` porta il verdetto **persistito dal gate** (code-sanity / reviewer) come segnale autorevole di avanzamento della catena. Questa è l'espressione a runtime del substrate §3.1 (avanza su evidenza persistita) + §6.9.2 (il gate è `done` solo quando soddisfatto).

**Ora.** Quando uno specialista termina (pi `agent_end`), il supervisore scrive già una riga di stato. Estendere il payload della riga con un `next_step_recommendation`:

- Cercare la riga con forma-risolta dell'Opportunità 3 per questa catena.
- Trovare l'indice del passo appena completato.
- Calcolare il passo successivo dal template.
- Emettere un `runner_event` di tipo `step_completed` con `{ completed: <role>, next: <role-or-null>, next_dispatch_command: "sp run <next> --bead <root> --job <this-job> --background" }`.

`sp result` (§5.2) legge questo e stampa il suggerimento del passo successivo. `sp chain <bead>` (Opportunità 4) legge gli stessi dati per popolare la sua visualizzazione.

**Perché.** Collega alla promessa di rev-9 §3 "il daemon fa avanzare la catena su member agent_end". Oggi è una *raccomandazione* (l'orchestrator digita ancora `sp run`); sotto substrate diventa *dispatch automatico*. Stessi dati, due modalità di consumo.

**Si legge in avanti.** Quando il daemon del substrate prende il controllo dell'avanzamento, lo stesso payload dell'evento fluisce nel percorso di auto-dispatch del daemon. Nessun cambiamento della forma dei dati.

#### Opportunità 9 — YAML di nudge per composizione

**Ora.** Rev-9 §6.9.5 L1 nudge (suggerimenti deterministici programmatici: "nessuna evidenza explorer nello scope → considerare explorer") sono una piccola lookup table. Implementabile oggi:

- `~/.config/specialists/composition-nudges.yaml`: regole con matcher `applies_when` (riutilizzando la sintassi di matcher che substrate usa ovunque — §5.2/§6.9.3) che producono hint "considera X perché Y".
- Consumato da `sp chain review` (Opportunità 4) e dall'hook Claude Code su bd create (§4).
- Il nudge è *informativo*, non un rifiuto. Stessa forma del nudge L1 di substrate.

**Perché.** Chiude B2. La regola è in un file di configurazione, regolabile per repo. La regola *solleva la domanda*, non aggiunge automaticamente — preservando il giudizio dell'orchestrator.

**Si legge in avanti.** Rev-9 §6.9.5 L1 è la stessa tabella, valutata dal composition-gate del substrate. Lo YAML di oggi è lo schema che substrate adotta invariato.

**Aggiornamento dalla riconciliazione:** la formula bd **non** supporta `applies_when` (§13.2, verificato contro il binario bd — il campo è silenziosamente ignorato). Il matcher di selezione/nudge quindi vive in un **file di configurazione di selezione separato** consumato dall'hook Claude (§4) e dal dispatcher `sp chain review`, non dentro le formule. "Un linguaggio di matcher in tutto il sistema" rimane valido — applicato al *livello di selezione*, esattamente come i nudge L1 di substrate §6.9.5 sono una lookup table valutata al composition gate, non parte di alcun template.

#### Opportunità 10 (NUOVA) — Riprogettazione `--chain <molecule-id>`: deprecare `--worktree` e `--job`, dispatch guidato dall'identità della catena

**Ora.** Sostituire l'attuale coppia di flag `--worktree` + `--job` con un singolo verbo di identità della catena: `--chain <molecule-id>`. La semantica del flag deriva il comportamento del worktree dallo stato della catena.

Questa opportunità è **il runtime che adotta in anticipo il modello di identità del substrate** (chiude §11.2). Substrate rende le operazioni con scope di contenitore — l'identità del workspace è interna, mai un handle API di prima classe. `--chain` È l'handle del contenitore nel bridge; `--job`-come-handle-workspace si dissolve. L'attuale metà-e-mezzo è la fonte delle sei asimmetrie; questa opportunità si imposta sul lato pulito.

**Superficie:**

```bash
sp run <role> --chain <molecule-id> --bead <bead-id>
```
**Albero decisionale:**

```
chain (molecule) exists in bd?
├── NO
│   └── specialist permission?
│       ├── READ_ONLY: refuse → "chain <id> doesn't exist; create it first via `bd mol pour` or `sp chain review`"
│       └── MEDIUM/HIGH: auto-create
│           ├── derive title from --bead's title (e.g., "Chain for <bead-title>")
│           ├── `bd mol pour <inferred-formula>` (if formula auto-resolves; otherwise default to code-standard) — creates the molecule
│           ├── `sp chain wire-edges <molecule-id>` post-pour helper applies semantic edges
│           ├── provision worktree at .worktrees/chain-<molecule-id>
│           ├── `bd merge-slot create` + acquire for the molecule
│           └── dispatch
│
└── YES (molecule + merge-slot exist; metadata has worktree_path)
    └── specialist permission?
        ├── READ_ONLY: bind by path (no merge-slot acquire), dispatch
        └── MEDIUM/HIGH:
            ├── merge-slot free → acquire, dispatch
            └── merge-slot held → queue (refuse with "WAIT: lease held by <job>; will dispatch on release")
```

```bash
sp run <role> --bead <bead-id>          # no --chain
```

```
specialist permission?
├── READ_ONLY: dispatch in cwd (single-shot ephemeral investigation; current behavior preserved)
└── MEDIUM/HIGH: REFUSE → "write-capable specialists require --chain <id> for safety. Use --chain X to bind to existing or auto-create."
```

**Perché.** Chiude le Asimmetrie **1 + 2 + 6** per inversione:

- **1 (executor come bootstrapper):** qualsiasi specialista può fare dispatch per primo in un `--chain` che si auto-crea. Executor perde il suo ruolo privilegiato di "primo dispatch crea worktree".
- **2 (worktree di proprietà del job):** il percorso del worktree risiede sul merge-slot (con scope chain). Il concetto di owner-job scompare.
- **6 (reviewer-as-parassita):** reviewer + `--chain X` entra nel worktree senza necessità che executor sia attivo (combinato con #1+#2 fusi).

Chiude anche **A4** (worktree orfani: ora vincolati a chain-molecule, non al job; eliminati alla chiusura della chain), **C1** (nessun più percorso cwd-mismatch per `--job` dato che `--job` è sparito), e previene interamente **R1/R2** (reviewer con `--chain` entra sempre nel workspace corretto).

**Corregge anche la falla di sicurezza esistente:** il comportamento attuale quando né `--worktree` né `--job` sono passati = dispatch gira in process.cwd. Per specialisti con capacità di scrittura questo può scrivere direttamente su master (non sicuro). La nuova regola "MEDIUM/HIGH rifiuta senza --chain" chiude esplicitamente questa falla. (Nota: il flag `--no-worktree` era già stato rimosso con l'intento di "auto-provision", ma l'implementazione dell'auto-provision era incompleta; questa opportunità la completa.)

**Si collega a.** Rev-9 §6.9.5 + §11.1: `sb dispatch --container <id>` è l'equivalente su substrate. La forma del verbo CLI è identica; solo `--chain` (backed da bd-epic) → `--container` (backed da substrate-container). La migrazione è una ridenominazione meccanica.

**Flusso di deprecazione.**

Periodo di grazia (1 release):

```
sp run executor --bead X --worktree
→ stderr warning: "[DEPRECATED] --worktree replaced by --chain. Auto-resolving --chain X.
                  Future: sp run executor --bead X --chain X"
→ behavior: same as --chain X (auto-creates if missing)

sp run reviewer --bead Y --job <exec-job>
→ stderr warning: "[DEPRECATED] --job replaced by --chain. Auto-resolving --chain <chain-id> from job lookup.
                  Future: sp run reviewer --bead Y --chain <chain-id>"
→ behavior: same as --chain <chain-id>

sp run executor --bead X                   # no flag, write-capable
→ TODAY: silently runs in cwd (unsafe)
→ NEW: refuse with "write-capable requires --chain. Use --chain X to auto-create or bind."
```

Taglio netto dopo il periodo di grazia: `--worktree`, `--job`, `--force-job` rimossi dal codice.

**Costo di implementazione: ~2 giorni.** Include la nuova gestione dei flag, gli avvisi di deprecazione, il flusso di auto-creazione integrato con Opportunity 1+2 (merge-slot) + Opportunity 3 (mol pour) + Opportunity 6 (chain-derived worktree naming).

#### Opportunità 11 (NUOVA) — Pull-not-push memory recall via mandatory rule

**Problema oggi.** `runner.ts` inietta `.xtrm/memory.md` + l'output di `bd prime` al spawn di OGNI specialista — ~3.8k token (memorie `specialist-runner-injects-xtrm-memory-md-bd-prime`, `bd-prime-context-overhead`). La maggior parte delle memorie iniettate è irrilevante allo scope del task corrente; lo specialista paga il context cost senza beneficio, e i task piccoli (code-sanity, obligations-scanner, doc-sync) sono particolarmente penalizzati perché la percentuale di memorie irrilevanti è altissima rispetto al loro budget naturale.

**Ora (cambio runtime).**

1. **Rimuovere** dal prompt-builder di `runner.ts` l'iniezione automatica di `bd prime` + dump completo di `.xtrm/memory.md`.
2. **Aggiungere** una nuova mandatory rule `config/mandatory-rules/memory-recall.md` (~30 righe) che insegna allo specialista:
   - **All'avvio**, identifica 2–4 keyword dal proprio bead (PROBLEM/SCOPE/keywords del titolo) e esegui `bd memories <keyword>` per ciascuna. Le keyword tipiche includono il nome del sottosistema toccato, il tipo di operazione (merge/migration/auth/...), eventuali nomi di file critici.
   - **Prima di decisioni rilevanti** (scelta di approccio, refactor che cambia API, esecuzione di operazione non banale), esegui un secondo round mirato sulla decisione in arrivo.
   - **`bd recall <key>`** per recuperare il payload completo di una memoria specifica vista in un risultato `bd memories`.
   - **Non** scorrere l'intero output di `bd memories` se >10 risultati — affina la keyword.
   - **Non** invocare `bd prime` (è un comando session-bootstrap, non per specialist runtime).
3. **Wiring**: la rule entra nel `template_sets` di default per tutti gli specialisti package-tier (in `config/specialists/*.specialist.json` mandatory_rules). Specialisti molto piccoli e pre-scriptati (`obligations-scanner`, `changelog-drafter`) possono opt-out esplicito se misurazioni mostrano che non beneficiano.

**Perché.** Allineamento filosofico con substrate's knowledge-scope principle (memoria `substrate-knowledge-scope-principle`): *"facts with metadata; queries reconstruct the slice."* substrate non pre-carica memorie — il curator al seed start le interroga *in base allo scope*. Opportunità 11 porta la stessa disciplina nel runtime oggi: la conoscenza è già queryable (bd memories indicizza per fulltext), basta smettere di fare il push indiscriminato e insegnare il pull mirato.

**Risparmio atteso.** ~3.8k token × ogni spawn specialista. Su una sessione tipica con 8–15 dispatch, si liberano 30–60k token di budget context che possono essere spesi su evidence reale (codice, diff, risultati di tool). Per specialisti haiku/mini il vantaggio relativo è massimo (3.8k su una window da 200k = 1.9%, ma su un task naturalmente piccolo da 20k è il 19%).

**Rischio mitigato.** "Lo specialista potrebbe non chiamare `bd memories` e ricadere in bug noti" — la mandatory rule è strutturata come *obbligo all'avvio* (non opzionale), con esempi concreti. Le rule mandatory entrano nel system prompt in coda, dove la compliance è alta. Misurabile via `bd memories <keyword>` tool-call rate negli specialist_events di observability.db dopo il rollout — gate review se rate <80% sui task non-trivial.

**Legge in avanti.** substrate §10 query layer + knowledge-scope principle. Quando substrate arriva, il dispatcher (§6.4) può precomputare un `memory_pack` mirato per ogni step-issue (come Graphify/TaskPrep faceva — memoria `graphify-taskprep-design-session`); l'evoluzione naturale è dispatcher-injected scoped pack invece di agent-queried pull. Ma il pull-not-push di oggi è il bridge corretto e già allineato — il dispatcher futuro non re-introduce il push indiscriminato.

**Costo: ~1 giorno.** Rimozione iniezione runtime (~30 LOC), nuova mandatory-rule file (~30 righe), aggiunta a template_sets dei ~14 specialisti package-tier (edit JSON diretto, package-tier non passa per sp edit per il gotcha CLAUDE.md). Niente nuove API, niente nuova infrastruttura — solo politica espressa come rule + rimozione di codice runtime.

**Sequenziamento.** Fase 1 (§10.1): è un win immediato di token-budget che non dipende da nessun'altra opportunità ed è completamente reversibile (rimuovi la rule, riaggiungi l'iniezione). Misurabile con A/B in 2–3 sessioni.

---

## 4. Strato ortogonale A — Hook Claude Code su `bd create`

La singola patch con ROI più alto nell'intero roadmap e ortogonale al substrato (opera uno strato sopra il runtime; sopravvive a rev-9 invariato). Intercetta mismatch tipo-forma PRIMA che qualsiasi specialista venga dispacciato.

### 4.1 Perché questo batte gli hint sp-runtime

- **Si attiva al momento giusto.** Gli hint da `sp run` arrivano DOPO che l'orchestratore ha già deciso di dispacciare uno specifico specialista. Gli hint da `bd create` arrivano quando il bead è fresco — l'operatore non ha ancora scelto lo specialista.
- **Intercetta i mismatch tipo-forma prima che costino un dispatch.** "type=bug + description suona come 'implementare una nuova feature' → forse type=task."
- **Usa il meccanismo di hook Claude Code esistente.** Nessuna nuova infrastruttura sp, nessun nuovo percorso daemon.
- **Cross-referenzia il registro live.** L'hook esegue `specialists list --full --json` e propone una chain i cui nomi di specialisti sono garantiti esistere (chiude B3+B4 direttamente).
- **Funziona offline rispetto a sp.** Anche se sp è rotto o il daemon è giù, l'hint si attiva.

### 4.2 Cablaggio dell'hook

Cabla come matcher `PostToolUse` su comandi Bash che corrispondono a `bd create` (PostToolUse così il bead id è già assegnato e visibile nell'output del tool):

```jsonc
// ~/.claude/settings.json (o .claude/settings.local.json per-progetto)
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "command_pattern": "^bd create\\b",
        "hook": "~/.claude/hooks/bd-create-hint.sh"
      }
    ]
  }
}
```

### 4.3 Calcolo dello script dell'hook

Dato `bd create --title="..." --type=<t> --priority=<p> --description="..."`:

1. **Inferenza severità / scrutiny** — scansione keyword su title + description contro la tabella della superficie di auto-escalation SCRUTINY (iron-review-hardening v3.5):
   - `auth/secret/credential/token/permission/migration/lockfile/.github/workflow/agent.*config` → `scrutiny=critical`
   - `database/cache/index/perf/race/concurrency` → `scrutiny=high`
   - tutto il resto → default del bead (o `medium`)
2. **Rilevamento mismatch tipo-forma** — euristica sulle forme verbali della description:
   - `type=task` ma la description inizia con "fix/resolve/regression/broken" → suggerisci `type=bug + workflow=debug`
   - `type=bug` ma la description inizia con "implement/add/introduce/create" → suggerisci `type=task + workflow=code-standard`
   - `type=task` ma lo scope è un cambio a file singola-riga → suggerisci `type=chore`
3. **Proposta workflow** — usando i 6 workflow da substrate-review §25.3 (hard-coded nell'hook per bridge):
   - `bug` → `debug` → `debugger → code-sanity → obligations-scanner → reviewer`
   - `task` + scrutiny=medium → `code-standard` → `executor → code-sanity → [security-auditor if surface] → obligations-scanner → reviewer`
   - `task` + scrutiny=high/critical → `code-with-advisors` → `explorer → methodologist → [code-standard]`
   - scope corrisponde a `analytics/**` o tags=quant → `quant-validation`
   - scope corrisponde a `auth|secrets|crypto|migrations|hooks` → `security-deep`
   - banale (scrutiny=low, ≤1 file in scope) → `code-quick`
4. **Risoluzione specialista** — per ogni step, cerca lo specialista risolto via `specialists list --full --json` (cached a `~/.claude/cache/specialists-list.json`, refresh ogni 10 min o su rilevamento-stale). Stampa modello + durata stimata.
5. **Cross-check compatibilità** — verifica che gli specialisti proposti esistano nel registro (chiude B4 al momento dell'hint, non al dispatch).
6. **Proposta template step-bead + cablaggio obbligatorio degli edge** (chiude R4 via Opportunity 5) — l'hook usa il pattern di title `<role>:<existing-id>` come **solo trigger di proposta**; lo step-status autorevole del bead risultante deriva dalla label `kind:step` che l'hook allega (per Opportunity 5: label = verità, title = hint). Se il title corrisponde al pattern:
   - Verifica che l'id radice esista; **rifiuta il bd create** con hint strutturato se non esiste (`STEP-BEAD WITH UNKNOWN ROOT: forge-eorh.99 not found; create root first or fix title`).
   - Proponi il template step-contract (mandate/inputs/outputs) invece di change-contract, e allega le label `kind:step`, `role:<r>`, `edge:<type>-><root>`.
   - **Esegui atomicamente** `bd dep add <new-bead> <root> --type <validates|informs|discovered-from>` immediatamente dopo che `bd create` ha successo. Tipo di edge derivato da ruolo per la tabella ruolo→edge di Opportunity 5. Le due operazioni avvengono sempre insieme — nessuna possibilità che l'operatore dimentichi la dep.

### 4.4 Output dell'hint

```
[bd-create-hint] bead created: forge-eorh.74 (type=bug, priority=1)

Severity inferred: scrutiny=high  (matched "auth retry" in description against surface table)
Type-shape check:  OK  (type=bug consistent with description verbs)

Suggested chain shape:  debug
  debugger (gpt-5.4-mini, ~3-6m)
    → code-sanity (gpt-5.4-mini, ~1-3m)
    → obligations-scanner (gpt-5.4-mini, ~30s)
    → reviewer (gpt-5.3-codex, ~2-4m)

Recommended dispatch:
  sp chain review forge-eorh.74    # composition gate (Opportunity 4)
  sp chain approve forge-eorh.74   # pour molecule + dispatch first step
  # — or, single-shot —
  sp run debugger --chain forge-eorh.74 --bead forge-eorh.74 --keep-alive --background

Registry version: registry@2026-05-26 (last refresh 12m ago; run `specialists list --full` to refresh)

If this proposal looks wrong:
  - type=bug but it's actually new code? Re-run `bd update forge-eorh.74 --type task`
  - scrutiny=high looks wrong? Re-check description for false-positive keywords
```
### 4.5 Cosa chiude

| Tag | Come |
|---|---|
| B1 (reviewer saltato per "fix da 1 carattere") | Il suggerimento elenca esplicitamente ogni passaggio richiesto dal flusso di lavoro; saltare diventa una decisione esplicita contro il testo stampato |
| B2 (explorer/methodologist saltato su blast HIGH) | Il suggerimento propone `code-with-advisors` per scrutiny=high; elencazione esplicita |
| B3 (nessun `specialists list --full` prima di attività sostanziale) | L'hook esegue l'aggiornamento del registro e stampa la versione |
| B4 (nomi/flag di specialisti inventati) | Gli specialisti proposti vengono cercati live; i nomi inventati non appaiono mai |
| D4 (sp run successo muto) | Ponte fino all'arrivo di §5.1 |
| R4 (confusione tracking-bead vs target-bead) | Pattern step-bead rilevato; template corretto proposto (tramite Opportunità 5) |

### 4.6 Costo

~1 giorno. Autonomo — nessun demone, nessuna patch a sp, nessuna lettura di observability.db.

---

## 5. Livello ortogonale B — suggerimenti sp-runtime + comando `sp chain`

Il livello 3a (§4) si attiva alla creazione di bead; questo livello si attiva durante e dopo `sp run`. I due sono complementari, ortogonali, entrambi necessari.

### 5.1 Suggerimento post-dispatch su `sp run`

Oggi `sp run` restituisce un job id e informazioni minimali. Proposta:

```
$ sp run executor --bead forge-eorh.48 --background
✓ Dispatched executor cc5fcc (model: gpt-5.4-mini, thinking: medium, scrutiny: medium)
  workspace: .worktrees/forge-eorh.48 (new)
  expected: ~3-6 min (executor avg)
  next: sleep 60 && sp ps; on completion → code-sanity (mandatory per Iron pipeline)
  flag check: --background OK. Did not see: --keep-alive (recommended for resumable runs)
  registry version: registry@2026-05-26 (run `specialists list --full` if outdated)
```

Chiude B1+B2+D4+D5. Implementazione: `src/cli/run.ts` ha già i dati — semplicemente non li stampa.

### 5.2 Suggerimento per il passo successivo basato sul risultato su `sp result`

```
$ sp result 5f2448
=== reviewer 5f2448 — PASS ===
[corpo del verdetto...]

✓ Verdict: PASS (score 96/100)
  next recommended: sp merge forge-eorh.48 — chain is ready
  workflow remaining: 0 gates pending
  prior chain ancestry: ✓ clean (no unmerged siblings)
```

Per PARTIAL: `next recommended: sp resume <exec-job-id> "address findings: <bullet list extracted from verdict>"`.
Per FAIL: `next recommended: escalate — reviewer FAIL is operator-decision (do NOT auto-retry)`.

Riutilizza le forme di flusso di lavoro substrate-review §25 — `sp result` consulta il flusso di lavoro e sa cosa viene dopo. Dopo l'arrivo dell'Opportunità 8, la raccomandazione viene letta dal payload dell'evento `step_completed` (calcolata una volta al momento dell'esecuzione, consumata dalla visualizzazione del risultato).

### 5.3 Hook di avviso pre-dispatch (automatici, non opt-in)

Quando viene invocato `sp run`, il runtime attiva questi controlli in <2s. Politica di severità per D13 (ibrida): **rifiuto netto per la classe perdita-dati**, avviso per le precondizioni soft.

| Controllo | Severità | Output |
|---|---|---|
| cwd è dentro un worktree e `sp run` viene eseguito per un bead diverso | **REFUSE** | `CWD MISMATCH (refuse): you're in <wt-path> for <bead-X> but dispatching for <bead-Y>. Data-loss risk per C1. Move out of the worktree or correct the bead arg.` |
| Specialista con capacità di scrittura senza `--chain` | **REFUSE** | Per Opportunità 10: `write-capable requires --chain. Use --chain X to auto-create or bind.` |
| Bead mancante di PROBLEM/SCOPE/VALIDATION/ACCEPTANCE | warn | `BEAD INCOMPLETE: <which fields>; specialist quality bounded by bead quality.` |
| Dispatch di reviewer/code-sanity senza `--job <exec-job>` (durante periodo di grazia deprecazione `--job`) | warn | `MISSING --job: reviewer without --job runs from clean checkout, diff context lost.` (post-grace: dissolved — reviewer uses `--chain`) |
| Dispatch di debugger ma issue.type è `task` non `bug` | warn | `TYPE MISMATCH: debugger is for bugs; this issue is type=task. Did you mean executor?` |
| Sto per saltare code-sanity su diff di produzione | warn | `SKIP NOT PERMITTED on production diff — only test-only or new-file-only diffs may skip.` |
| `--force-stale-base` senza `--reason` | warn (grazia) | `STALE BASE REFUSED: pass --reason "<why>" to acknowledge (Opportunity 7).` |
I primi due chiudono **C1** e la falla di sicurezza esistente cwd-write-to-master — la categoria perdita-dati. Implementazione: `sp run` legge `pwd`, analizza il percorso del worktree, verifica incrociata rispetto all'id della issue. Nota: L'Opportunità 10 (`--chain` che depreca `--job`) **dissolve R1/R2/R5** interamente — una volta che `--chain` è il gestore del workspace, quei controlli vanno in pensione come no-op; realizzarli ora solo come warn-bridge per il periodo di grazia.

### 5.4 `sp chain <molecule-id>` vista dashboard CLI

Già descritta sotto Opportunità 4 (§3.2). Riepilogata per completezza — questo comando unifica i dati dalle Opportunità 3 + 8 in un'unica visualizzazione che l'operatore può eseguire invece di assemblare mentalmente `sp ps` + `git log` + note delle bead:

```
$ sp chain forge-eorh.48
chain: forge-eorh.48 — "Materializer.writeIssues hard-codes substrate shape"
workflow: code-standard   scrutiny: medium   worktree: .worktrees/forge-eorh.48 (clean)

  ✓ executor          cc5fcc  PASS   3m12s   model: gpt-5.4-mini
  ✓ code-sanity       d6eacc  OK     1m45s   model: gpt-5.4-mini  findings: 0
  → reviewer          7b3775  RUNNING 1m20s   model: gpt-5.3-codex  avg: 2-4m
  ○ merge             pending

evidence so far:
  diff:    feature/forge-eorh.48-executor (8 files, +234/-189)
  verdicts: code-sanity OK; reviewer pending
next recommended (when reviewer PASS): sp merge forge-eorh.48
git state: clean; ahead of main by 3 commits on executor branch
```

**v0 shape (decided D24):** read-once, human-viewable + `--json` flag. **`-f` follow mode deferred** — naive repaint-loop has the same flicker pattern as `sp ps -f`, needs its own small-CLI/TUI design pass before shipping.

**Cross-surface visibility — `sp log`.** All new chain-lifecycle events introduced by Phase 1–3 (Opportunity 8 `step_completed`, the `--chain` resolution events from Opportunity 10, merge-slot acquire/release from Opportunity 1+2, `sp chain wire-edges` post-pour events, chain-close events from §5.6.2) must surface in `sp log` so operators can trace chain transitions from the unified runtime log without polling `sp ps` or running `sp chain` repeatedly. `sp log` is the canonical observability surface; new event kinds = new `sp log` row formatters. Implementation note for the rollout: each opportunity that emits a new event kind must include the matching `sp log` formatter in the same PR — no event ships dark.

### 5.5 Diagnostica dirty-index di `sp merge`

Quando `sp merge` rileva un `git status --porcelain` non vuoto contenente solo `.beads/issues.jsonl`, NON riportare "Merge conflict" — riporta:

```
sp merge refused: dirty index from bd-auto-export race
  fix: git restore --staged .beads/issues.jsonl
  then: retry sp merge
  see: <link to repo-bootstrap docs> for the permanent fix
```

Chiude D3. Costo: mezza giornata. **Decisione (chiuso D18 — ricalibrato per runway):** **LAND**. A1 si è ripresentato 5× in una sessione (gitboard 2026-05-26) e la runway del substrate è dell'ordine di un mese su ~10 repo attivi. Costo-ricorrenza × repo × runway giifica la mezza giornata molte volte. Saltare solo se `xtrm-h9hqg` (bd auto-stage flip + pre-commit shim) viene rilasciato prima e A1 smette dimostrabilmente di ricorrere — stessa causa radice attaccata da due angolazioni. Resta un bridge throwaway (`sb container merge` transazionale del substrate §22 rimuove la causa interamente), ma la runway rende un bridge throwaway degno di essere costruito.

### 5.6 Hook di igiene di `sp ps` — evidenzia le righe waiting / error invecchiate con azioni consigliate

Il keep-alive è una feature, non un bug (risparmia 20–30k token per re-dispatch per il resume). L'attrito è l'operatore che dimentica di scansionare `sp ps` per job in stato `waiting`/`error` e non li chiude mai. La correzione sono **hook che evidenziano la coda di igiene con raccomandazioni azionabili**, non rimuovere il keep-alive.

#### 5.6.1 Vista `sp ps --hygiene`

```
$ sp ps --hygiene
ACTIVE (3):
  running   cc5fcc  executor       unitai-kglvm    5m elapsed
  running   7b3775  reviewer       unitai-kglvm    1m20s elapsed
  waiting   d6eacc  code-sanity    unitai-kglvm    2h waiting (no resume signal)   ⚠ HYGIENE

ACTION RECOMMENDED:
  d6eacc has been waiting 2h. Chain unitai-kglvm reviewer is running; once it passes,
  run `sp chain close unitai-kglvm` to release this and related keep-alive jobs atomically.

ERROR (1):
  error     a3b9c1  debugger       unitai-kglvm.5   killed (sigterm) 4h ago         ⚠ HYGIENE

ACTION RECOMMENDED:
  a3b9c1 errored. Bead unitai-kglvm.5 has no progress since. Decide:
    - sp clean --ps a3b9c1     (acknowledge + hide; preserves observability)
    - sp resume a3b9c1 "..."   (retry with steer)
    - escalate to operator     (mark bead blocked, document in notes)
```

#### 5.6.2 Punti di integrazione degli hook

- **Stop hook** (infrastruttura `.xtrm/hooks/` esistente) lancia `sp ps --hygiene --quiet` a fine sessione; se ci sono elementi di igiene non nulli, **blocca Stop** con la lista delle azioni. Questo chiude l'attrito di classe B tramite nudge diretto.
- **PreToolUse hook su Bash** per `bd close <bead>`: se la bead è un molecule e `sp ps --chain <bead>` mostra righe waiting/error, avvisa: `CHAIN HAS UNCLOSED KEEP-ALIVE JOBS: <list>. Close them via sp chain close <molecule> first, or use sp stop <job> for individual cleanup.`
- **Banner periodico di igiene** nell'output predefinito di `sp ps`: se una riga è in waiting >1h o in error, mostra un banner monoriga `⚠ N hygiene items — run sp ps --hygiene for actions`.
- **`sp chain close <molecule-id>`** nuovo verbo: chiude atomicamente tutti i membri della catena (rilascia merge-slot, ferma i job keep-alive in attesa, transiziona la chain-molecule a `done`). Sostituisce il workflow `sp finalize` per la pulizia con scope catena. Il vecchio `sp finalize` continua a funzionare come alias durante il periodo di grazia.

#### 5.6.3 Perché questo preserva il valore del keep-alive

- L'operatore NON perde MAI il vantaggio di ripresa di 20–30k token; il keep-alive stesso rimane invariato.
- L'attrito è esclusivamente **scoperta + sollecito**: l'operatore dimentica di scansionare, gli hook di igiene rendono la scansione automatica.
- Gli specialisti di sola lettura (Opportunità 1+2) riducono ulteriormente l'urgenza: il loro keep-alive mantiene solo la propria sessione pi, nessun accoppiamento con l'executor.

**Lettura in avanti.** Lo stato del terminale del container del Substrate + la distillazione della memoria per §5.10 assorbe tutto questo. La chiusura della catena diventa derivata dall'evidenza (substrate §22), non comandata. Fino ad allora, gli hook di igiene di `sp ps` rendono la chiusura manuale scopribile.

**Costo.** ~1 giorno. Lo hook di stop è infrastruttura esistente; lo hook PreToolUse è uno script shell che wrappa `sp ps`; il banner periodico è una one-liner nel formattatore di `sp ps`.

---

## 6. Livello ortogonale C — config-skill di bootstrap per-repo

**Decisione (D19 chiusa): ENTRAMBI** — spedire come skill discoveribile standalone `xtrm-tools/skills/repo-bootstrap` **e** cablare l'esecuzione automatica in `xt init`. Con ~10 repo attivi su una finestra di lancio di un mese, il percorso automatico-on-init conta per i nuovi repo; la skill standalone serve i repo già esistenti che non vengono re-inizializzati.

**Divisione tra questa audit e `xtrm-h9hqg` (lato operatore, IN_PROGRESS, P0).** Verificato rispetto al ticket:

**Coperto da `xtrm-h9hqg` (NON duplicare qui):**

- **B-A1** — ricetta auto-stage bd: `bd config set export.git-add false` + shim di append a `.git/hooks/pre-commit` DOPO i marcatori bd.
- **B-A2** — i tre casi `hooksPath`/terze parti che l'audit cataloga: (i) `core.hooksPath` onorato (reroute); (ii) `core.hooksPath` mal configurato a `.beads/hooks` in mercury/{market-data, market-data-uuj, platform, terminalbeta}; (iii) pre-commit non-bd sul target — framework precommit.com → plugin, wrapper security-pipeline → append sicura, runner custom fast-unit-tests → decisione manuale.
- **B-A3** — fallback per repo bd-dolt rotto: scrive direttamente lo YAML + logga follow-up per riparare Dolt.
- Più scope extra `xtrm-h9hqg` non in questa audit: versione bd/gitnexus + verifica migrazione.

Risultati dello sweep da `xtrm-h9hqg`: 12/23 repo patchati, 4 bloccati su hooksPath, 7 su hook di terze parti — dati ambientali autorevoli.

**NON coperto da `xtrm-h9hqg`** — rimane come lavoro lato friction-audit (archiviare separatamente o estendere lo scope h9hqg):

**B-A4.** Effettua sweep e report dei worktree orfani: `git worktree list | grep -v master`, classifica come (a) attivi (corrisponde a un job aperto in `sp ps`), (b) già-mergiati (branch target presente in `git log master`), (c) genuinamente abbandonati. Rimuove automaticamente (b)+(c) con `git worktree remove`; flagga (a) per revisione dell'operatore. **Valore ponte:** ogni sessione oggi perde tempo su questi; la pulizia è 30s per repo.

**B-A5.** Assicura che la config di test escluda il glob `.worktrees/` — applica la patch che gitboard ha dovuto fare manualmente. Rilevamento per-linguaggio (vitest config, pytest.ini, jest.config).

**B-A6.** Documenta e opzionalmente installa il wrapper `SKIP=osv-scanner` come shell function per-repo `xt-push` che la skill insegna all'operatore di usare dentro i worktree.

**Futuro-substrate:** §13.2 rende il daemon lazy-launch al primo comando, il che rimuove gran parte della fragilità dell'hook bd. Il bootstrap per-repo è un ponte — ma ad alto valore perché risolve il dolore ricorrente del "repo stale" oggi.

---

## 7. Modalità di errore specifiche del reviewer (R1–R7)

La `Regola Non-Negoziabile 7` ("Il reviewer usa il proprio bead e workspace executor tramite `--job <exec-job>`") nasconde almeno sette modalità di fallimento distinte. Ognuna necessita del proprio check pre-dispatch, implementato in `src/cli/run.ts` quando `specialistName === 'reviewer'`. Legge da `observability.db` + bead store. Economico (<200ms).

| Tag | Modalità di errore | Check pre-dispatch |
|---|---|---|
| **R1** | Reviewer dispatchato senza `--job <exec-job>` → parte da checkout pulito, non vede diff | Se non c'è `--job` E il bead target ha un arco `validates` verso un bead con un job executor aperto, rifiuta con `next: sp run reviewer --bead <X> --job <exec-job-id>` |
| **R2** | `--job <exec-job>` punta a un executor stale/completato il cui worktree non corrisponde più al diff attuale (l'executor è stato ripreso; HEAD si è mosso) | Confronta lo SHA dell'ultimo commit di `<exec-job>` contro l'HEAD del worktree ora; se diverso, avvisa: `EXECUTOR JOB AT STALE HEAD: <job-sha> vs worktree-head <wt-sha>; resume executor or dispatch fresh review` |
| **R3** | Reviewer dispatchato PRIMA che il gate obbligatorio `code-sanity` sia stato eseguito (violazione pipeline Iron) | Verifica se esiste un job `code-sanity` con verdetto PASS per lo stesso `--job <exec-job>`. Se no, avvisa (non rifiutare — l'operatore potrebbe avere un motivo) |
| **R4** | L'operatore confonde tracking-bead con target — `--bead <reviewer-tracking-bead>` dove il bead è "reviewer for X" invece di `--bead X` direttamente | Parsa titolo/descrizione del bead target per pattern di prefisso "reviewer:" / "code-sanity:"; se corrisponde, cerca X e avvisa: `BEAD LOOKS LIKE TRACKING-BEAD; did you mean --bead <X>?` (L'Opportunità 5 rende questo strutturalmente impossibile a lungo termine) |
| **R5** | Manifestazione specifica-reviewer di C1 — la cwd dell'operatore è in un worktree diverso | **Implementato come il check di hard-refuse cwd-mismatch di §5.3** (singola fonte di verità — non duplicare). L'Opportunità 10 (`--chain` che depreca `--job`) **dissolve R5 interamente** post-grazia: il binding del workspace fluisce dall'identità della catena, nessuna divergenza cwd-vs-`--job` possibile. R5 qui è un puntatore indietro a §5.3 per la finestra ponte. |
| **R6** | Bead con `scrutiny=critical` ma nessun gate `security-auditor` nella storia della catena | Quando si dispatcha un reviewer con `scrutiny>=high` e la superficie corrisponde alla tabella §6.6 sensitive-surface, verifica job security-auditor precedente; se mancante, rifiuta: `SCRUTINY=critical requires security-auditor before reviewer for this surface` |
| **R7** | Reviewer dispatchato due volte per lo stesso target — l'operatore ha dimenticato un verdetto PASS precedente | Verifica esistenza di verdetto PASS sullo stesso `--job <exec-job>`; avvisa: `PRIOR REVIEWER VERDICT EXISTS: <prior-job-id> PASS at <ts>; dispatch only if rebuttal or post-fix re-review` |
| **R8** | Reviewer dispatchato con `--bead <tracking-bead>` ma il tracking-bead non ha arco `validates` verso la sua root (tracking-bead orfano — creato bare, wiring dell'arco dimenticato) | Verifica se gli archi uscenti di `--bead` includono `validates` verso un bead root aperto; **rifiuta** con: `STEP-BEAD IS ORPHAN: <bead-id> has no validates edge to a root. Run \`bd dep add <bead> <root> --type validates\` first, or recreate via Claude hook (auto-wires per Opportunity 5).` Si applica simmetricamente a `code-sanity`, `obligations-scanner`, `security-auditor`. |

R8 è l'applicazione a tempo di dispatch del wiring obbligatorio dell'Opportunità 5 — cattura gli step-bead creati tramite tooling che bypassa l'hook Claude (`bd create` raw in uno script, bead più vecchi precedenti all'hook, ecc.). Dopo che l'Opportunità 5 + l'hook §4 sono universalmente adottati, R8 diventa un check di difesa-in-depth che raramente si attiva.

La stessa forma si applica a `code-sanity`, `obligations-scanner`, `security-auditor` — hanno tutti bisogno di `--job <exec-job>` e hanno modalità di mismatch simili. Generalizzare dopo che R1–R8 sono spedite per il reviewer.

**Lettura in avanti.** Il flusso di chiusura del substrate §22 + le semantiche di lease §6.9.6 assorbono tutti e sette: R1/R2/R5 diventano impossibili (ogni partecipante nel container legge il worktree del container; il lease del container traccia l'HEAD corrente); R3 diventa il contratto di completezza §6.9.2; R4 si dissolve sotto il doppio-contratto §6.9.2; R6 si dissolve sotto il layer obbligatorio §6.9.3; R7 si dissolve sotto la derivazione-di-chiusura §22. I check del reviewer sono ponti. **Priorità di build (per ricalibrazione runway §F):** R3/R6/R7/R8 *sopravvivono all'Opportunità 10* e meritano implementazione completa; R1/R2/R5 si riducono ad avvisi/hint che vanno in pensione quando finisce il periodo di grazia di `--job` — non costruire due volte.

---

## 8. Audit di riuso + mappa ponte substrate-future

### 8.1 Audit di riuso

Per la disciplina del substrate-review §18: ogni patch proposta deve mappare a un primitivo esistente o essere un ponte temporaneo. Cross-check:
| Patch | Riutilizza esistente | Nuova superficie? |
|---|---|---|
| Opportunità 1 — Colonne lease worktree | tabella jobs/status; evento `agent_end` | 2 colonne |
| Opportunità 2 — Binding percorso READ_ONLY | tag `permission: READ_ONLY` (già esiste); percorso worktree su `--job` | branch runtime nel runner |
| Opportunità 3 — Persistere forma catena | tabella jobs/status | 1 tabella o JSON-per-catena |
| Opportunità 4 — `sp chain review/approve/insert` | dati Opportunità 3; i 6 workflow hard-coded | 3 verbi CLI |
| Opportunità 5 — Convenzioni bead step | tag bd + pattern titolo; hook Claude Code | solo convenzione |
| Opportunità 6 — Naming branch | template branch worktree.ts | 1 modifica template |
| Opportunità 7 — `--accept-stale-base --reason` | flag esistente, rinominato + arg richiesto | rename flag minore + forma envelope |
| Opportunità 8 — Evento `step_completed` | `runner_event` + observability.db | un tipo evento + payload |
| Opportunità 9 — Nudge composizione | sintassi matcher già in logica seed-invite se presente; else valutatore minimale | uno schema YAML |
| Hook Claude Code (§4) | `specialists list --full --json` (esiste); meccanismo Claude Code PostToolUse | uno script shell + wiring settings.json |
| Hint sp-runtime (§5.1–5.3) | dati `sp run`/`sp result` già presenti | blocchi stderr + ~6 controlli pre-dispatch |
| CLI `sp chain` (§5.4) | dati Opportunità 3 + Opportunità 8 | un comando, workflow hard-coded per bridge |
| Diagnostica dirty `sp merge` (§5.5) | `git status` + wrapper merge esistente | solo testo errore |
| Skill bootstrap (§6) | `xt init` + `bd config` + `git worktree` | una skill |

Nessuna proposta introduce un nuovo demone, nuovo IPC, nuova entità. Ogni proposta è o un miglioramento text-emission, un thin CLI wrapper sopra dati esistenti, o colonne shimmed su tabelle esistenti.

### 8.2 Mappa bridge substrato-futuro

Per ogni patch, cosa bridgea e se sopravvive al substrato.

| Patch | Sostituzione substrato-futuro | Sopravvive al substrato? |
|---|---|---|
| Opportunità 1 — Colonne lease worktree | §6.9.6 lease su container (migrazione: rename + trasferimento ownership) | **Sì** — semantica sopravvive, storage si sposta |
| Opportunità 2 — Binding percorso READ_ONLY | §6.9.6 step read-only non acquisiscono lease | **Sì** — semantica identica |
| Opportunità 3 — Persistere forma catena | §6.9.2 forma risolta su container | **Sì** — rename e re-attach |
| Opportunità 4 — `sp chain review/approve/insert` | §6.9.5 + §11.1 `sb chain review/approve/insert` | **Sì** — rename binario `sp` → `sb`; forma verbo identica |
| Opportunità 5 — Convenzioni bead step | §6.9.2 schema dual-contract | **Sì** — convenzione promossa a schema |
| Opportunità 6 — Naming branch | §6.9.7 nomi da membership | **Sì** — naming si estende annidando container |
| Opportunità 7 — `--accept-stale-base --reason` | §11 gate precondizione + channels.md §10.2 envelope | **Sì** — keeper |
| Opportunità 8 — Evento `step_completed` | §3 demone-avanza-su-agent_end | **Sì** — stesso payload, consumo automatico vs informativo |
| Opportunità 9 — Nudge composizione | §6.9.5 nudge L1 | **Sì** — stesso YAML, valutato dal demone |
| Hook Claude Code (§4) | indipendente dal runtime; sopravvive a qualsiasi futuro | **Sì** — opera sopra il runtime |
| Hint sp-runtime (§5.1–5.3) | dashboard substrato §12 + §17.1 feed Change-tracking | **Sì** — hint CLI aiutano operatori offline anche con dashboard |
| CLI `sp chain` (§5.4) | `sb container ps <container-id>` | Per lo più Sì — rename CLI; un po' di retargeting (vedi caveat Opportunità 4) |
| Diagnostica dirty `sp merge` (§5.5) | §22 chiusura transazionale rimuove la causa | **No** — throwaway; implementare solo se frequenza giustifica costo |
| Skill bootstrap (§6) — pezzo bd auto-stage | §13.2 demone lazy + store pulito rimuove la maggior parte delle cause | Parzialmente — parti specifiche bd vanno in pensione; pulizia worktree sopravvive |
| Check reviewer R1–R7 (§7) | §6.9.6 + §6.9.2 + §22 prevenzione strutturale | **No** — R1/R5 diventano impossibili; R2/R3/R6/R7 assorbiti da altri primitive. Implementare solo perché chiudono attrito reale oggi; ritirare su substrato. |

**Bridge da saltare** (il substrato sostituisce pulitamente entro tempo ragionevole): `sp merge dirty-index diag` è l'unico candidato genuino; check reviewer R sono giustificati dall'attrito.

**Bridge che valgono la pena costruire** (valore indipendente o sopravvivono al substrato): tutto il resto.

---

## 9. Riferimento meccanismo — `sp finalize` e `--force-stale-base`

Due meccanismi che questo audit referenzia ripetutamente. Fondamentazione contro codice reale così che le proposte di patch (§3.7, §5.3, §7) e la mappa bridge substrato-futuro (§8.2) sono basate su cosa queste cose fanno realmente, non folklore.

### 9.1 `sp finalize <job-id>` — il trigger keep-alive di chiusura catena

**Sorgente:** `src/cli/finalize.ts` (wrapper CLI) → `src/specialist/control.ts:155 finalizeJob` (logica).

**Meccanismo:**

1. Esecutore dispatchato con `--keep-alive` → dopo il primo `agent_end` di pi, il supervisore imposta lo status a `waiting` (supervisor.ts:1658+1974) invece di chiudere la sessione pi.
2. Reviewer dispatchato con `--job <exec-job>` → entra nello *stesso* workspace ereditando il binding worktree dell'esecutore, esegue review, termina anch'esso in `waiting`.
3. Code-sanity / security-auditor / obligations-scanner funzionano allo stesso modo.
4. Quando il verdetto del reviewer è PASS, l'operatore esegue `sp finalize <any-chain-member-job>`.
5. `finalizeJob` (control.ts:155):
   - Risolve `chain_id` dal job passato
   - Legge il verdetto del reviewer da `observability.db.specialist_results` (SQLite-first); fallisce back a `result.txt` solo quando `SPECIALISTS_JOB_FILE_OUTPUT=on`
   - Se verdetto è PASS → chiude TUTTI i membri keep-alive in waiting della catena in una passata
   - Se non-PASS o non-waiting → rifiuta

**Perché esiste:** senza `--keep-alive`, la sessione pi dell'esecutore si chiude al primo `agent_end` e il reviewer non può entrare via `--job`. Keep-alive permette alla catena di iterare (reviewer PARTIAL → resume esecutore → re-review). `sp finalize` è il trigger "catena davvero conclusa, rilascia risorse".

**Modo di fallimento:** se l'operatore dimentica `sp finalize`, i job restano in `waiting` per sempre — leak di risorse (contesto pi mantenuto in memoria, slot tmux, righe observability che crescono). L'hook Stop prova a catturare questo alla fine-sessione ma sessione ≠ catena.
**Mitigazione indiretta dell'Opportunità 2:** quando gli specialisti READ_ONLY non richiedono più owner-keep-alive, l'esecutore può essere rilasciato prima — l'urgenza di `sp finalize` diminuisce ancor prima che substrate lo rimuova interamente.

**Sostituzione futura in substrate (vedi §22):** `sp finalize` scompare, non viene migrato. Quando il revisore scrive l'evidenza PASS, il container reducer deriva `close_ready` e `sb container merge` chiude transazionalmente tutte le issue membri. La chiusura è derivata dall'evidenza, non comandata separatamente.

### 9.2 `--force-stale-base` — il bypass del guardiano stale-base

**Fonte:** `src/cli/run.ts:273 assertNoStaleBaseSiblings` (guardia) e il flag `--force-stale-base` in run.ts:115.

**Cosa verifica la guardia:** prima di qualsiasi dispatch `sp run`, per il bead target:

1. Risolve l'epic del bead via `resolveEpicIdForBead` (ritorna subito se il bead non ha epic)
2. Elenca le chain sibling sotto quell'epic via `listEpicChainsWithLatestJob`
3. Per ogni sibling con un branch: chiama `previewBranchMergeDelta(branch)` + `evaluateMergeWorthiness`
4. Se uno qualsiasi sibling ha commit che valgono la merge (non ancora su master) → **rifiuta il dispatch**

**Bypass:** `--force-stale-base` salta il controllo con un debole avviso stderr e procede.

**Perché si attiva troppo spesso** (mercury 2026-05-25 ha usato il bypass per ogni dispatch della sessione): la guardia vede un branch sibling con commit avanti rispetto a master e assume "lavoro non mergiato." Ma il lavoro equivalente potrebbe essere già su master sotto uno *SHA diverso*:

- Sibling mergiato via GitHub PR fuori dal flusso `sp epic merge`
- Branch mai cancellato localmente dopo la PR-merge; worktree mai potato
- Cherry-pick in master con SHA riscritto

Il `evaluateMergeWorthiness` della guardia fa un controllo strutturale del delta, non un controllo patch-id / equivalenza-contenuto.

**Patch (Opportunità 7):** rinominare in `--accept-stale-base --reason "<testo>"`, envelope di rifiuto strutturato con `next_safe_action: diagnose|accept|abandon-chain`, rilevamento patch-id opzionale come obiettivo esteso.

**Sostituzione futura in substrate (vedi §21 + §22.3):** il controllo stale-base è un gate di precondizione al momento del dispatch §6.4 (violazione di precondizione, non recupero §5.10). Il formato del rifiuto corrisponde a channels.md §10.2.

### 9.3 Pattern comune — compensazione per modello mancante

`sp finalize` e `--force-stale-base` sono entrambi workaround per un modello assente:

- `sp finalize` esiste perché non c'è una regola che dice *"una chain è chiusa quando la sua evidenza del revisore è PASS e tutti i membri sono in waiting."* Senza quella regola, l'operatore comanda la chiusura manualmente.
- `--force-stale-base` esiste perché non c'è un modello di *"il lavoro sibling è equivalente se il suo patch-id corrisponde a qualcosa su master."* Senza questo, la guardia rifiuta, l'operatore fa override.

Il contributo di substrate a entrambi è **rendere esplicito il modello**, così la compensazione procedurale scompare. Stesso pattern di substrate-review §22 (memory-ack / commit-gate / Stop hook tutti cancellati, non migrati). Il friction audit cataloga *ogni* posto in cui stiamo pagando il modello-assente con procedure dell'operatore; le patch in §3, §4, §5, §6 riducono quella tassa ora, e substrate la elimina.

---

## 10. Sequenza master di rollout

Lista ordinata singola che combina le opportunità di allineamento (§3) con i layer ortogonali (§4 / §5 / §6). Ordinata per **leverage-per-giorno** — ciò che rimuove più dolore (o sblocca più lavoro successivo) per giorno speso.

**Inquadramento del runway (governa §10.5 / priorità R-check / scope template-vs-archetype).** Substrate potrebbe essere a un mese o più di distanza, durante il quale l'operatore lavora su ~10 repo in parallelo. Attrito-rimosso-per-giorno × giorni-fino-a-substrate × repo è grande, quindi anche un bridge temporaneo onesto ripaga molte volte prima di andare in pensione. Fondamentalmente, **le patch a livello bd sono da mantenere fino alla migrazione substrate §13.7 bd→substrate — che è *più tardi* dell'arrivo di substrate**, non coincidente. bd rimane lo store delle issue *e* (via mol/formula/swarm) lo store della forma delle chain durante tutto il periodo di adozione di substrate. La disciplina di riuso delle primitive bd (§3.0) è essa stessa una vittoria di runway: ogni "bridge" qui è colla sottile sopra primitive che bd già mantiene, non nuova infrastruttura da portare. Due ricalibrazioni concrete ne derivano: D18 (land `sp merge` dirty diagnostic, era "skip") e i controlli R del revisore (costruire R3/R6/R7/R8 completamente; ridurre R1/R2/R5 a avvisi/suggerimenti che vanno in pensione con `--job`).

### 10.1 Fase 1 — Visibilità, disaccoppiamento, igiene (ROI immediato più alto, ~4 giorni)

| Ordine | Elemento | Fonte | Costo | Perché primo |
|---|---|---|---|---|
| 1 | **Hook Claude Code su `bd create`** | §4 | 1 giorno | Patch con leverage più alto in assoluto — si attiva prima di qualsiasi dispatch, chiude B1/B2/B3/B4/D4/R4 indirettamente |
| 2 | **Opportunità 1+2 (fuse) — bd merge-slot lease + binding percorso READ_ONLY** | §3.2 | 2 giorni | Rimuove le asimmetrie 2+4+6 in un'unica integrazione usando primitive bd esistenti; chiude il coupling più costoso |
| 3 | Opportunità 8 — evento `step_completed` con raccomandazione prossimo passo | §3.2 | 1 giorno | Sblocca le superfici di suggerimento §5.1/§5.2; fondazionale per la Fase 2 |
| 4 | Hook di igiene sp ps §5.6 (nudge Stop hook + PreToolUse su bd close + banner periodico) | §5.6 | 1 giorno | Rende autogestita la disciplina di keep-alive dell'operatore; preserva il valore del keep-alive |
| 5 | **Opportunità 11 — Pull-not-push memory recall** (rimozione iniezione bd prime/.xtrm/memory.md al spawn + nuova mandatory rule `memory-recall.md` + wiring template_sets) | §3.2 / D27 | 1 giorno | Win immediato di token-budget (~3.8k token recuperati per spawn × 8–15 dispatch/sessione = 30–60k token liberati); reversibile; indipendente da altre opportunità; misurabile via tool-call rate di `bd memories` post-rollout |

Dopo la Fase 1: l'orchestrator riceve suggerimenti contestuali al momento giusto; reviewer/code-sanity smettono di tenere in ostaggio le sessioni pi dell'esecutore; le raccomandazioni del prossimo passo fluiscono attraverso lo stream di eventi; i nudge di igiene prevengono leak silenziosi di risorse; gli specialisti tirano (pull) le memorie pertinenti invece di pagare il costo di context per il dump completo.

### 10.2 Fase 2 — Riprogettazione chain (il cambiamento strutturale sostanziale, ~5 giorni)

| Ordine | Elemento | Fonte | Costo | Dipendenze |
|---|---|---|---|---|
| 5 | **Opportunità 10 — riprogettazione `--chain <molecule-id>` con deprecazione --worktree/--job** | §3.2 | 2 giorni | Opportunità 1+2 (usa bd merge-slot) |
| 6 | Opportunità 3 — Persisti forma chain via bd mol pour | §3.2 | 1.5 giorni | File formula bd per i 6 template predefiniti |
| 7 | Opportunità 4 — comando `sp chain review/approve/insert` | §3.2 | 2 giorni | Opportunità 3 + 10 |
| 8 | Blocchi di suggerimento sp-runtime (§5.1, §5.2, §5.3) | §5 | 1 giorno | Opportunità 8 (#3 della Fase 1) |

Dopo la Fase 2: la riprogettazione chain è operativa. `--chain` è il singolo verbo di identità della chain. `sp chain review` è il gate di composizione. Lo stato della chain è interrogabile via struttura bd mol. Gli avvisi pre-dispatch catturano C1 (rifiuto netto per perdita dati, §5.3); R1/R2/R5 sono dissolti sotto `--chain` (nessun double-build).

### 10.3 Fase 3 — Convenzioni ed ergonomia (~3 giorni)
| Ordine | Elemento | Fonte | Costo |
|---|---|---|---|
| 9 | Opportunità 5 — Convenzioni step bead (integrazione hook Claude + cablaggio atomico obbligatorio degli edge) | §3.2 | 1 giorno |
| 10 | Opportunità 6 — Nomi branch/worktree dalla catena | §3.2 | 0,5 giorno |
| 11 | Opportunità 7 — Ridenominazione `--accept-stale-base --reason` + envelope + periodo di grazia di 1 release | §3.2 | 0,5 giorno |
| 11b | **D26 prereq per D23** — edit `config/specialists/planner.specialist.json` output_schema con `recommended_template: enum(<13 formula names> \| 'on-the-run')` + aggiornare `config/skills/planning/SKILL.md` per insegnare Pass-2 (annotare ogni root bead con `recommended_template`, NO materializzazione step bead a planning time) | §11.0 D26 / §11.4 | 0,5 giorno |
| 12 | Opportunità 9 — Regole di composizione-nudge come file di selection-config esterno (NON sezioni formula — `applies_when` non supportato da bd formula per §13.2/E3); consumato da §4 hook + `sp chain review` | §3.2 | 1 giorno |
| 13 | Controlli pre-dispatch revisore R1–R8 — build full per R3/R6/R7/R8 (sopravvivono Opp 10); R1/R2/R5 ridotti a warn/hint che si ritirano con `--job` (vedi §F runway recalibration in §10 intro) | §7 | 1 giorno |

Dopo la Fase 3: l'orchestrator non può confondere tracking-bead con target (R4/R8 chiusi); la nomenclatura si allinea al substrate; l'override stale-base è tracciabile per audit; i nudges di explorer/methodologist pongono la questione sui lavori HIGH-blast; gli errori del revisore sono bloccati al dispatch.

### 10.4 Fase 4 — riscrittura decorazione sp epic (~2 giorni, vedi §12)

| Ordine | Elemento | Fonte | Costo |
|---|---|---|---|
| 14 | Rimuovere `sp epic merge` (rotto, proibito); stub di deprecazione che rimanda al workflow git manuale | §12 | 0,5 giorno |
| 15 | Rimuovere `sp epic abandon` + tabella `epic_runs` + macchina a stati `epic-lifecycle.ts` + `epic-readiness.ts` + `epic-reconciler.ts` + `checkEpicUnresolvedGuard` | §12 | 1 giorno (rimozione codice) |
| 16 | Riscrivere `sp epic list` + `sp epic status` come thin reader (figli bd + join di osservabilità) | §12 | 0,5 giorno |

Dopo la Fase 4: attrito bloccante sp epic eliminato. sp epic = pura decorazione. Orchestrazione merge multi-catena gestita da git manuale (Playbook Cherry-Pick) finché non arriva `sb container merge` nel substrate. Risparmio di ~500 righe di codice rimosso (lifecycle + readiness + reconciler).

### 10.5 Fase 5 — Bootstrap per-repo (diviso tra `xtrm-h9hqg` e friction-audit)

| Ordine | Elemento | Fonte | Proprietario | Costo |
|---|---|---|---|---|
| 17a | Ricetta auto-stage bd (B-A1) + casi hooksPath/third-party (B-A2) + fallback bd-dolt rotto (B-A3) | §6 | `xtrm-h9hqg` (P0, **CLOSED 2026-05-27** — verified per D25) | ✓ done |
| 17b | Pulizia worktree orfani (B-A4) + esclusioni vitest `.worktrees/` (B-A5) + wrapper osv-scanner (B-A6) | §6 | lato friction-audit (archiviare separatamente o espandere scope h9hqg) | 1 giorno |
| 18 | Diagnostica dirty-index in `sp merge` | §5.5 | sp | 0,5 giorno — **LAND per D18** (runway ricalibrato: 5× ricorrenza × ~10 repo × mese di runway ripaga molte volte; saltare solo se h9hqg viene rilasciato prima E A1 si ferma) |
| 19 | `xt init` esegue automaticamente la skill di bootstrap sui nuovi repo (D19) | §6 | xtrm-tools | 0,5 giorno |

Dopo la Fase 5: i nuovi repo partono puliti; l'attrito ricorrente di classe A (stato dirty, worktree orfani, test-runner che raccoglie file worktree) non è più un costo per-sessione.

### 10.6 Fase 6 — Generalizzazione dei controlli pre-dispatch (~3 giorni, post-substrate-ready)

R1–R8 era specifico del revisore. Dopo il rilascio e la validazione, generalizzare lo stesso pattern per code-sanity / obligations-scanner / security-auditor. ~1 giorno per ruolo; totale ~3 giorni. Non bloccante; può essere eseguito dopo la Fase 5.

### 10.7 Riepilogo fasi

| Fase | Giorni | Cumulativo | Sblocco chiave |
|---|---|---|---|
| 1 — Visibilità, disaccoppiamento, igiene, memory pull | 5 | 5 | L'orchestrator ottiene hint pre-dispatch; READ_ONLY disaccoppia; disciplina keep-alive auto-applicata; specialisti tirano memorie scoped invece di pagare dump completo |
| 2 — Ridisegno catena | 5 | 10 | --chain è il singolo verbo; stato catena interrogabile; --worktree/--job deprecati |
| 3 — Convenzioni ed ergonomia | 3,5 | 13,5 | Step bead strutturalmente puliti; errori revisore prevenuti; i nudges sollevano questioni di composizione; planner spec + planning skill insegnano `recommended_template` |
| 4 — Decorazione sp epic | 2 | 15,5 | Attrito bloccante sp epic eliminato; ~500 righe rimosse |
| 5 — Bootstrap repo | 1 | 16,5 | h9hqg già chiuso (B-A1/A2/A3); B-A4/A5/A6 + diagnostica sp merge + auto-run su xt init |
| 6 — Generalizzazione pre-dispatch | 3 | 19,5 | Altri ruoli gate ottengono controlli pre-dispatch |

**~15,5 giorni per le Fasi 1–4** (lavoro core sul runtime specialist), più Fase 5 in parte già fatta sotto xtrm-tools + ~1 giorno friction-audit-side, più Fase 6 dopo come rifinitura.

### 10.8 Cosa questo rollout NON fa (scope onesto)

- **Non implementa il container seed/pianificazione.** Seed risiede nel substrate propriamente detto (§5 di rev-9).
- **Non implementa la primitiva channel.** I canali restano dove sono (bozza specialists v0 per canali.md §11 sequencing).
- **Non introduce una tabella `containers`.** Tutto il lavoro è shimmed su primitivi chain-identity / bd-epic / bd-mol esistenti. La tabella containers arriva con substrate §15 Stage 4.
- **Non modifica la semantica keep-alive.** Opportunità 1+2 disaccoppia la liveness cross-job; keep-alive intra-job per il resume è preservato.
- **Non ritira `bd`.** bd rimane lo store di issue + store di chain-shape (via bd mol). bd è potenziato dall'uso degli hook Claude e dalle convenzioni step-bead; non viene sostituito finché non viene eseguita la migrazione substrate §13.7.
- **Non introduce worktree a livello epic.** Solo a livello catena. L'integrazione base epic substrate §6.9.7 (`wt/epic-<id>/chain-<id>`) è lavoro futuro quando substrate sarà disponibile.

Queste sono le cose per cui *non costruire ponti*. Sopravvivono intatte nel substrate; costruire ponti ora significa lavoro doppio.

---

## 11. Registro decisioni

Tutte le domande precedentemente aperte tra le iterazioni di design sono ora risolte. §11.0 è la matrice delle decisioni (D1–D23); §11.1 riconduce le domande pre-implementazione dell'operatore alle relative decisioni; §11.2/§11.3 sono le due domande dell'autore rev-9, entrambe chiuse; §11.4 documenta la nuova aggiunta `recommended_template` del planner.

### 11.0 Decisioni prese durante la riconciliazione (per riferimento del planner)

| # | Domanda | Decisione |
|---|---|---|
| D1 | Policy epic bd | **MANTENERE** — bd epic è il contenitore organizzativo sopra le chain (§1.1.1); l'identità della chain stessa è la molecola (D17/rifinitura §13.3 del precedente modello mentale `chain ≡ bd epic`) |
| D2 | Epic nidificati permessi? | **SÌ** — Confermato al 100% nell'attuale versione bd; pattern: epic di livello superiore → molecola-chain → bead di step (3 livelli); la disciplina corrisponde all'avviso soft del substrato §14 #3 a profondità 2 tra layer organizzativi |
| D3 | Policy `--keep-alive` | **MANTENERE INVARIATO** — è una feature, non un bug; preserva 20-30k token di valore per il resume; Opportunità 1+2 disaccoppia solo la liveness cross-job, keep-alive intra-job preservato |
| D4 | Riutilizzo primitive bd (`merge-slot`, `mol`, `formula`, `swarm`) | **USARE** — sostituisce ~4 tabelle sp/verbi CLI net-new originariamente pianificati (§3.0) |
| D5 | Scope worktree | **Solo a livello chain** — worktree epic rinviati al substrato §6.9.7 |
| D6 | Destino di `sp epic merge` | **RIMUOVERE** — architettura decorazione completa (§12); git canonico manuale fino al substrato |
| D7 | Destino di `sp epic abandon` | **RIMUOVERE** — no-merge significa niente coppia abandon/merge; bd close gestisce l'audit |
| D8 | `sp epic sync` + tabella `epic_runs` + macchina a stati | **RIMUOVERE** — servono tutti l'orchestrazione che viene rimossa |
| D9 | `checkEpicUnresolvedGuard` | **RIMUOVERE** — la guardia esiste solo per forzare lo sp epic merge rimosso |
| D10 | `--chain` vs altro nome per nuovo verbo dispatch | **`--chain <molecule-id>`** confermato |
| D11 | Creazione chain: implicita vs esplicita | **ENTRAMBE** — esplicita via `sp chain review` (multi-step), implicita via `sp run --chain X` auto-crea (ergonomica single-shot) |
| D12 | Write-capable senza `--chain` | **RIFIUTARE** — chiude una falla di sicurezza esistente (dispatch cwd predefinito poteva scrivere su master) |
| D13 | Policy severità avvisi pre-dispatch | **Ibrida** — rifiuta per rischi di perdita dati / precondizioni hard (C1 cwd mismatch, R5 reviewer cwd mismatch, write-capable senza --chain); avvisa per precondizioni soft (bead incompleto, --job mancante durante periodo di deprecazione, violazioni ordinamento R3) |
| D14 | Migrazione `--accept-stale-base --reason` | **Periodo di grazia di 1 release** che accetta `--force-stale-base` con avviso di deprecazione, poi taglio netto |
| D15 | Hook Claude auto-aggiunge archi step-bead | **SÌ, nessun prompt di conferma** — il tipo di arco è deterministico dal ruolo; conferma per step aggiunge attrito |
| D16 | Nomi verbi `sp chain` | **`review` / `approve` / `insert`** (1:1 con `sb chain review/approve/insert` del substrato); migrazione è rinomina binaria `sp`→`sb`, nessuna rimappatura per verbo. (Era `plan/dispatch/insert`.) |
| D17 | Accettazione argomento `sp chain <id>` | **Solo id molecola root** — argomento step-bead rifiutato con hint che rimanda alla molecola tramite l'arco `parent-child` dello step |
| D18 | Diagnostica indice sporco `sp merge` (§5.5) | **IMPLEMENTARE** — costo di ricorrenza (5× in una sessione) × ~10 repo × runway di un mese giustifica mezza giornata. Saltare solo se `xtrm-h9hqg` viene rilasciato prima E A1 smette demonstrabilmente di ricorrere |
| D19 | Posizione skill bootstrap per-repo | **ENTRAMBI** — skill standalone scopribile `xtrm-tools/skills/repo-bootstrap` (per repo esistenti) E automatica su `xt init` (per nuovi repo); runway di un mese su ~10 repo rende rilevanti entrambi i percorsi |
| D20 | Label `kind:step` vs pattern titolo come discriminatore step-vs-root | **La label è verità, il titolo è hint.** Per substrato §6.9.7 (il nome non è la semantica): tag autorevole `kind:step` (+ label `edge:<type>-><target>`). Il pattern titolo `<role>:<root-id>` è *solo* il trigger che l'hook Claude usa per *proporre* un template step-contract al momento della creazione bd. `sp chain wire-edges` legge le label, mai i titoli. |
| D21 | Esposizione identità workspace nell'API runtime (era §11.2) | **Interno al substrato, NON esposto.** Le operazioni sono scoped al contenitore; nessun `workspace_id` di prima classe. I partecipanti vengono spawnati nei contenitori (§7.1); il contenitore detiene il worktree + lease (§6.9.6). L'Opportunità 10 realizza questo in anticipo — `--chain` è l'handle del contenitore, `--job`-come-handle-workspace si dissolve |
| D22 | Percorso di migrazione all'arrivo della tabella containers (era §11.3) | **Passaggio meccanico di rinomina; molecola bd → contenitore `kind: chain` del substrato.** `opened_by` per i contenitori sintetici legacy deve essere marcato `opened_by: synthetic-pre-substrate:<first-job-id>` così non viene confuso con la provenienza reale che un seed scriverà in seguito. Gli archi `parent-child`/`validates` degli step-bead pre-popolano le relazioni degli step — nessuna ricostruzione del grafo necessaria |
| D23 | Campo `recommended_template` nell'output del planner (§D) | **ADOTTARE.** Il Pass-2 del planner annota ogni bead root figlio con `recommended_template: <uno dei 13 nomi di formula + on-the-run>`. Validato contro `bd formula list` live. È una proposta, non una materializzazione — risolta al momento di `sp chain review` / `bd mol pour`, non al momento della pianificazione. **Prereq (D26):** edit di `config/specialists/planner.specialist.json` + `config/skills/planning/SKILL.md` prima del ship |
| D24 | Shape v0 di `sp chain <id>` | **read-once, human-viewable + `--json`.** `-f` follow mode deferito al proprio pass di design (repaint naive → flicker, stesso pattern di `sp ps -f` — richiede un piccolo TUI dedicato). Nuovi eventi chain-lifecycle dalle Fasi 1–3 emergono in `sp log` (ogni nuovo event kind ships con il suo `sp log` formatter nello stesso PR — nessun evento ships dark) |
| D25 | Stato `xtrm-h9hqg` | **CHIUSO** (verificato 2026-05-27 in xtrm-tools: implementato bd auto-stage patch in xt init/update, dependency maintenance checks, modalità sweep `--all-repos`, test, dist smoke). B-A1/A2/A3 fatti; B-A4/A5/A6 rimangono lato friction-audit (Fase 5 riga 17b) |
| D26 | Prereq planner-spec + planning-skill per D23 | Aggiungere `recommended_template` richiede di toccare: (a) `config/specialists/planner.specialist.json` — estendere output_schema con `recommended_template: enum(<13 nomi formula> \| 'on-the-run')` (validato contro `bd formula list` a runtime); (b) `config/skills/planning/SKILL.md` — insegnare il Pass-2 (annotare ogni bead root figlio con `recommended_template`; NON materializzare step beads al momento del planning — quello è il lavoro di `sp chain review`). Land come singolo PR; entrambi i file sono package-tier, quindi edit JSON / Markdown diretti per il gotcha nel CLAUDE.md. Sequenziato in Fase 3 (§10.3) prima del wiring nudge dell'Opportunità 9 |
| D27 | Memory injection: push → pull (Opportunità 11) | **ELIMINARE** l'iniezione automatica di `bd prime` + `.xtrm/memory.md` al spawn (~3.8k token irrilevanti). **SOSTITUIRE** con mandatory rule `config/mandatory-rules/memory-recall.md` che insegna allo specialista a interrogare `bd memories <keyword>` / `bd recall <key>` in base al proprio scope all'avvio e prima di decisioni rilevanti. Allineato a substrate knowledge-scope principle ("facts with metadata; queries reconstruct the slice"). Rule entra nel template_sets di default di tutti gli specialisti package-tier; opt-out esplicito ammesso per specialisti pre-scriptati molto piccoli. Sequenziato Fase 1 (§10.1) — win immediato di token-budget, reversibile, indipendente |

### 11.1 Decisioni operative prima dell'implementazione

Tutte le questioni precedentemente aperte sono state risolte. Catturate come **DECISO** qui sotto (riferirsi a §11.0 per la riga della decisione):

1. ~~Convenzione di naming per i verbi sp chain / accettazione argomenti~~ — **DECISO** D16 (verbi: `review/approve/insert`), D17 (solo id molecola root).
2. ~~Policy severità avvisi pre-dispatch~~ — **DECISO** D13 (ibrida: rifiuto hard per classi perdita dati, avviso per precondizioni soft).
3. ~~Periodo di grazia `--accept-stale-base`~~ — **DECISO** D14 (grazia di 1 release).
4. ~~Posizione skill bootstrap per-repo~~ — **DECISO** D19 (entrambi: skill standalone + automatica su `xt init`).
5. ~~Polling vs streaming per `sp chain <molecule-id>`~~ — **DECISO** D24: v0 read-once (human + `--json`); `-f` deferred (richiede mini-TUI dedicato per evitare il flicker pattern di `sp ps -f`). Nuovi eventi chain-lifecycle devono apparire in `sp log` (vedi §5.4).
6. ~~Confermare che `xtrm-h9hqg` copra lo scope della Fase 5~~ — **DECISO** (§B6 / divisione §6): h9hqg copre B-A1/A2/A3 + extra; B-A4/A5/A6 rimangono lato friction-audit.
7. ~~Diagnostica indice sporco `sp merge` — implementare o saltare?~~ — **DECISO** D18 (IMPLEMENTARE, runway ricalibrata).

### 11.2 ~~Questione aperta per l'autore rev-9~~ — RISOLTO (D21)

Vedere §11.0 D21. Chiuso: l'identità workspace è interna al substrato, mai esposta nell'API runtime. `--chain` (bd-molecule oggi; substrate-container domani) è l'unico handle che i partecipanti vedono. L'Opportunità 10 implementa questo impegno in anticipo — ecco perché non è solo un bridge ma il runtime che adotta il modello identitario del substrato prima che il substrato arrivi.

### 11.3 ~~Questione aperta sul percorso di migrazione (arrivo tabella containers)~~ — RISOLTO (D22)

Vedere §11.0 D22. Chiuso: rinomina meccanica. Con il modello chain ≡ bd molecule (§1.1.1 / §13.3), la migrazione è ancora più pulita — `bd molecule` → contenitore `kind: chain` del substrato; step beads → issue di step (i loro archi `parent-child`/`validates` pre-popolano già la relazione di step per §6.9.2). Per i contenitori sintetici legacy, `opened_by` deve essere taggato `opened_by: synthetic-pre-substrate:<first-job-id>` così il contratto di provenienza del substrato (§2.6 — `opened_by` è immutabile, normalmente un seed/nodo/operatore) non viene confuso con la provenienza scritta da seed reali in seguito. I dati sono già a forma di substrato; la migrazione è un passaggio di rinomina.

### 11.4 Novità: `recommended_template` sul planner — pianificazione a due passaggi (D23 / §D)

Il planner ottiene un output strutturato Pass-2, più pulito perché i template sono veri file `bd formula`:

- **Pass 1 (già lo fa):** PRD → epic + bead root figli (ciascuno una futura issue root del substrato). Questa è la composizione Momento-1 del substrato (§6.9.5); zero debito.
- **Pass 2 (insegnare ora):** per ogni root figlio, annota **`recommended_template: <uno dei 13 nomi di formula>`** (`code-standard`, `debug`, `quant-validation`, …) + opzionalmente `recommended_extra_steps` per classi che la formula non include ma lo scope richiede (il delta di giudizio L3 sopra il template L1, §6.9.5).

Tre discipline mantengono questo come *proposta*, non una *materializzazione*:

- **È un NOME di formula, non una lista di step.** Il nome si risolve nella forma al momento di `sp chain review` / `bd mol pour`, non al momento della pianificazione. Nessuna materializzazione prematura di step-bead, nessun orfano.
- **`recommended`, non `resolved`.** L'orchestratore al momento del dispatch può sovrascrivere con informazioni di sibling-chain (Momento-2 del substrato). Se si legge come deciso, il giudizio al momento del dispatch viene saltato.
- **L'enum è i 13 nomi di formula + `on-the-run`** (valvola di sfogo: quando nessuna va bene, la forma viene specificata esplicitamente al dispatch). L'enum è concreto e verificabile — **`bd formula list` restituisce esattamente questi nomi**, quindi l'hook Claude (§4) e `sp chain review` possono validare `recommended_template` contro una lista live piuttosto che una tabella hard-codata. Il planner non può inventare nomi di formula che il resolver non riesce a trovare.

**Mappatura zero-debito.** `recommended_template` è lo stesso campo che usa il planner del substrato (§6.4); i valori puntano a veri file `bd formula` che esistono oggi. Implementazione: estendere l'output_schema dello specialist planner con il campo + enum; consumare in §4 (l'hook stampa "planner recommended: code-standard") e Opportunità 4 (`sp chain review` usa il template raccomandato come default quando presente, override via `--template`).

**Nota a margine — il catalogo valida indipendentemente substrato §6.9.8 + §6.9.10.** Diversi dei 13 template sono chain *deliberative/maintenance* (`planning`, `premortem`, `research-only`, `triage`, `doc-sync`, `memory-hygiene`) che producono una decisione o artefatto di maintenance, non un diff di codice — realizzazioni pulite dei tipi di issue deliberativi del substrato §6.9.8 (chiusura con outcome `decided` per §6.10). E `security-deep` con il suo `security-auditor` ×2 (advisor pre-, gate post-) è esattamente il punto "stesso ruolo a due classi" del substrato §6.9.10 come vera formula.

---

## Appendice — Matrice di cross-reference

Per la sessione di pianificazione: mappare ogni tag di attrito alle patch che lo chiudono, e ogni asimmetria architetturale alle patch che la rimuovono.

### Attrito → patch

| Tag attrito | Patch che lo indirizzano |
|---|---|
| A1 (bd auto-export race) | §6 bootstrap (recipe), §5.5 sp merge diagnostic (bridge) |
| A2 (bd hooks silent no-op) | §6 bootstrap (detection + reroute) |
| A3 (broken bd-dolt repos) | §6 bootstrap (manual YAML fallback + operator escalation) |
| A4 (orphan worktrees) | §6 bootstrap (cleanup pass) |
| A5 (test-runner picks up `.worktrees/`) | §6 bootstrap (per-language config) |
| A6 (osv-scanner / push-hook crashes) | §6 bootstrap (xt-push wrapper) |
| B1 (skipped reviewer) | §4 Claude hook (explicit list), §5.1 post-dispatch hint, Opportunity 4 (composition gate) |
| B2 (skipped explorer/methodologist) | §4 Claude hook, Opportunity 9 (nudges) |
| B3 (no specialists list refresh) | §4 Claude hook (auto refresh + version print) |
| B4 (invented flags / specialist names) | §4 Claude hook (registry cross-check) |
| B5 (`--force-stale-base` as default) | Opportunity 7 (`--accept-stale-base --reason`) |
| B6 (hand-edit managed files) | SKILL.md reinforcement + bootstrap skill detection |
| B7 (executor `--no-verify`) | §5.3 pre-dispatch warning; longer-term substrate §22 |
| C1 (cwd persistence wipe) | §5.3 cwd-mismatch warning + R5 reviewer check |
| C2 (stale base) | Opportunity 7 + Opportunity 1 (lease prevents over-dispatch) |
| C3 (reviewer without --job) | R1 pre-dispatch check |
| C4 (bead VALIDATION narrower than pre-commit) | Bead-creation guidance via §4 Claude hook |
| (orphan tracking-beads — new) | Opportunity 5 mandatory wiring + R8 dispatch-time check |
| D1 (silent swallow) | Errors-never-swallowed audit (part of §10.6 polish; can pull earlier) |
| D2 (executor tests_pass unreliable) | **Opportunity 8** payload carries code-sanity / reviewer verdict as authoritative chain-advancement signal (verification-authority-belongs-to-independent-gate principle, promoted to §2.D / §3.2 Opp 8) |
| D3 (sp merge "Merge conflict" mute) | §5.5 dirty-index diagnostic |
| D4 (sp run mute success) | §5.1 post-dispatch hint |
| D5 (no result next-step suggestion) | §5.2 result-aware hint + Opportunity 8 |
| D6 (no chain timeline view) | Opportunity 4 (`sp chain` command) + Opportunity 3 (chain shape data) |
| D7 (memory injection wastes ~3.8k token/spawn — memorie `bd-prime-context-overhead`, `specialist-runner-injects-xtrm-memory-md-bd-prime`) | **Opportunity 11** (pull-not-push memory recall via mandatory rule) |

### Asimmetria → patch

| Asimmetria | Patch che la rimuovono |
|---|---|
| 1 — Executor as chain bootstrapper | Opportunity 4 (composition gate) + Opportunity 10 (--chain redesign — any specialist can dispatch first) |
| 2 — Worktree owned by job | Opportunity 1+2 fused (bd merge-slot lease, chain-scoped) + Opportunity 10 (--chain drives provisioning) |
| 3 — Chain has no entity row | Opportunity 3 (bd mol pour materializes chain) + Opportunity 6 (chain-derived naming) |
| 4 — Keep-alive paradox | Opportunity 1+2 fused (READ_ONLY decoupling from owner-job liveness; intra-job keep-alive preserved) |
| 5 — `--bead` conflate contract+key | Opportunity 5 (step bead conventions + mandatory atomic edge wiring) + §4 Claude hook (template selection) |
| 6 — Reviewer-as-parasite | Opportunity 1+2 fused (READ_ONLY binds by path, no executor required) + Opportunity 10 (--chain semantic explicit) |

Ogni attrito è affrontato da almeno una patch; ogni asimmetria è rimossa da almeno una opportunità di allineamento. La matrice di riferimento incrociato è l'invariante dell'audit — se un'iterazione di pianificazione elimina una patch, controllare questa matrice per vedere quale attrito o asimmetria rimane scoperto.

---

## 12. Strategia di decorazione `sp epic`

Catturata dai risultati mappati dall'explorer (job 2b6a44 contro `unitAI-ueron`) e dalla discussione di riconciliazione. **Il principio:** sp mantiene il flag `--epic` + la colonna `specialist_jobs.epic_id` (portante per query trasversali) ma **elimina tutta la logica di orchestrazione epic**. Il workflow git manuale (Cherry-Pick Playbook) è canonico fino al rilascio di `sb container merge` nel substrate.

### 12.1 Cosa fa sp epic OGGI (mappato dall'explorer)

| Superficie | File | Comportamento |
|---|---|---|
| `sp epic list [--unresolved] [--json]` | epic.ts:285-318 | enumera epic_runs + valutazione di prontezza per epic |
| `sp epic status <id> [--json]` | epic.ts:478-511 | stato persistito + stato dei job per catena |
| `sp epic sync <id> [--apply] [--json]` | epic.ts:573-635 | rilevamento drift (job morti, riferimenti di catena obsoleti, flag di integrità) + riparazione opzionale |
| `sp epic abandon <id> --reason <text> [--force] [--json]` | epic.ts:657-680 | contabilità di stato terminale con audit trail |
| `sp epic merge <id> [--rebuild] [--pr] [--target-branch <name>]` | epic.ts:344-437 | merge multi-catena topologico + gate tsc + auto-shelve albero sporco |
| `sp epic resolve` | — | **GIÀ RIMOSSO** in `unitAI-aurbi.10` (2026-05-08) — la prontezza derivata ha sostituito la transizione esplicita |
| `sp run --epic <id>` | run.ts:114,125-130 | passa epicId a SupervisorOptions; il supervisor fa upsert di epic_runs + epic_chain_membership + sincronizza la prontezza derivata (supervisor.ts:947-973) |
| `sp run --bead X` auto-resolve | run.ts:206-212 | se `bd show X --field parent` è type=epic, deriva epic_id automaticamente |
| `sp run --epic X --job Y` validation | run.ts:125 | rifiuta se Y appartiene a un epic diverso |
| `sp ps` epic grouping | ps.ts:320-322,687-735 | raggruppa i job per epic_id; renderizza banner epic con readiness_state + persisted_state |
| `sp end --epic <id>` | end.ts:125-146 | short-circuit verso `handleEpicMergeCommand` |
| `checkEpicUnresolvedGuard` | merge.ts:514 | blocca `sp merge <chain>` se la catena appartiene a un epic non risolto |

### 12.2 Modello dati OGGI

| Tabella | Schema | Scopo |
|---|---|---|
| `epic_runs` | observability-sqlite.ts:642-647 | Stato del ciclo di vita persistito (epic_id PK, status, status_json, updated_at_ms) |
| `epic_chain_membership` | observability-sqlite.ts:652-660 | Collegamento Catena→epic (chain_id PK, epic_id, chain_root_bead_id, chain_root_job_id) |
| `specialist_jobs.epic_id` | observability-sqlite.ts:422,1096-1123 | Colonna indicizzata per query con scope epic |
Stati del ciclo di vita (epic-lifecycle.ts:18): `open|resolving|merge_ready` (non terminali) → `merged|failed|abandoned` (terminali).

### 12.3 Pattern di attrito dai report di sessione (conferma la preoccupazione dell'utente sul "sistema di blocchi")

| Pattern | Fonte | Evidenza |
|---|---|---|
| `sp epic merge` fallisce su albero sporco → l'epic transiziona in `failed` terminale SENZA recovery via CLI | 2026-05-04-2b52300a:240 | "Il fallback documentato è git merge --no-ff manuale per catena, ma salta i gate tsc/conflitti" |
| La macchina a stati dell'epic si è ingarbugliata quando i job keep-alive si sono fermati → `failed` invece di `merge_ready` | 2026-04-26-523fc559:116,131 | "Usato git merge --no-ff diretto invece di sp epic merge" |
| "ciclo di dipendenze rilevato" con radici multiple di catena per bead | 2026-05-04-2b52300a:457 | Catene di retry fallite coesistono in epic_runs insieme a catene riuscite |
| `sp epic merge` rifiutato su catene già merged → epic incastrato in `failed` | 2026-04-29-e9919694:85 | Corretto in `unitAI-tejk7` (idempotenza), ma il pattern persiste |
| Stato `failed` persistito ha bloccato il recovery anche dopo che le catene sono andate in PASS | 2026-05-08-1e257afe:157 | Corretto: validazione rilassata per `failed` non bloccante |
| `checkEpicUnresolvedGuard` blocca `sp merge <chain>` standalone | merge.ts:514 | Forza `sp epic merge` come percorso canonico; sp epic merge è fragile → blocco |

**Tema comune:** la guardia forza `sp epic merge`, che fallisce su casi angolari di dirty/retry/macchina a stati, bloccando l'epic. L'operatore deve sbloccare manualmente.

### 12.4 Cosa RIMUOVERE

| Componente | Perché | Migrazione |
|---|---|---|
| `sp epic merge` | Orchestrazione fragile; gli operatori già usano il fallback a git manuale per catena secondo CLAUDE.md gotcha #1 ("prohibited") | Stub deprecato: stampare "DEPRECATED & PROHIBITED: use manual git workflow (Cherry-Pick Playbook in SKILL). bd epic structure remains canonical." Poi no-op. |
| `sp epic abandon` | No-merge significa niente coppia abandon/merge; il ciclo di vita collassa | Rimuovere. bd `bd close <epic-id> --reason "..."` copre l'audit tramite note bead. |
| `sp epic sync` | Se la tabella `epic_runs` viene rimossa, non c'è deriva da sincronizzare | Rimuovere CLI. `epic-reconciler.ts:syncEpicState` diventa codice morto, rimosso. |
| Tabella `epic_runs` + macchina a stati `epic-lifecycle.ts` + derivazione `epic-readiness.ts` + `epic-reconciler.ts` | Tutti servono solo l'orchestrazione che viene rimossa | Rimuovere interamente. ~500 righe di codice rimosse. |
| `checkEpicUnresolvedGuard` (merge.ts:514) | Forza l'uso del canonico `sp epic merge` che viene rimosso | Rimuovere. `sp merge <chain>` diventa sempre permesso (l'operatore governa la sicurezza cross-chain tramite `--accept-stale-base --reason` secondo Opportunità 7). |
| `sp end --epic <id>` | Scorciatoia verso sp epic merge (rimosso) | Rimuovere la modalità `--epic`. Mantenere `sp end --bead <X>` per pulizia fine-sessione a singola catena. |

### 12.5 Cosa MANTENERE

| Componente | Perché |
|---|---|---|
| Flag `sp run --epic <id>` | Associazione esplicita di appartenenza all'epic visibile all'operatore |
| Auto-risoluzione `sp run --bead X` da `bd show X --field parent` | Convenienza: deriva l'epic dal parent del bead |
| Colonna `specialist_jobs.epic_id` (indicizzata) | Portante per query trasversali ("mostrami tutti i job across tutte le catene dell'epic X") |
| Cross-validation `--epic X --job Y` | Difesa in profondità; sebbene quasi irrilevante una volta deprecato `--job` (Opportunità 10) |
| Visualizzazione colonna epic_id in `sp ps` | Visibilità dell'operatore sull'appartenenza all'epic per job |
| Tabella `epic_chain_membership` | MANTENERE — collega catene agli epic per raggruppamento sp ps |
| `sp epic list` riscritto come thin reader | Legge `bd list --type=epic` + join di osservabilità per conteggi job |
| `sp epic status <id>` riscritto come thin reader | Legge `bd swarm status <epic>` + stato job per-catena di osservabilità |

### 12.6 Architettura di decorazione (stato target)

```
            ┌─────────────────────────────────────────┐
            │     bd: source of truth for             │
            │   - epic structure (--type=epic, --parent)│
            │   - DAG of work (bd swarm, bd dep tree)  │
            │   - epic lifecycle (bd epic close-eligible)│
            │   - merge readiness (bd swarm validate)  │
            │   - chain shape (bd mol pour, Opp 3)    │
            │   - chain lease (bd merge-slot, Opp 1+2)│
            └─────────────────┬───────────────────────┘
                              │ read-only
                              ▼
            ┌─────────────────────────────────────────┐
            │     sp: dispatch + observability only   │
            │   - sp run --chain X --bead Y           │
            │   - sp chain review/approve/insert       │
            │   - sp ps (epic_id column, grouping)    │
            │   - sp epic list/status (thin readers)  │
            │   - DROPPED: merge, abandon, sync, guard│
            │   - DROPPED: epic_runs lifecycle SM     │
            └─────────────────────────────────────────┘
                              │ manual git for multi-chain merge
                              ▼
            ┌─────────────────────────────────────────┐
            │  substrate (future): containers replace │
            │     bd epic + sp epic decoration with   │
            │     unified container/issue model       │
            └─────────────────────────────────────────┘
```
### 12.7 Ambito di implementazione (Fase 4 del rollout master)

- **Passo 1 (0.5 giorni):** Stub `sp epic merge` come no-op deprecato. Aggiornare CLAUDE.md gotchas + SKILL §Non-Negotiable Rules.
- **Passo 2 (1 giorno):** Rimuovere `sp epic abandon`, `sp epic sync`, `checkEpicUnresolvedGuard`, scritture su `epic_runs` table, `epic-lifecycle.ts`, `epic-readiness.ts`, `epic-reconciler.ts`. Migrazione: righe esistenti in `epic_runs` preservate in sola lettura per query storiche; nessuna nuova scrittura. La migrazione dello schema può droppare la tabella dopo un ciclo di release.
- **Passo 3 (0.5 giorni):** Riscrivere `sp epic list` + `sp epic status` come thin reader usando `bd list --type=epic` + `bd swarm status` + observability.db job join.

Totale: **2 giorni di lavoro codice + cleanup**, ~500 righe rimosse, sistema blocker eliminato.

**Substrate-future:** quando `sb container merge` (revisione §22) sarà disponibile, la decorazione sp epic viene rimossa interamente insieme alla migrazione bd epic → substrate container (§13.7).

---

## 13. Template di catena — concretizzati in `docs/design/chain-templates/`

I 13 template di catena predefiniti sono stati concretizzati come file `bd formula` in `docs/design/chain-templates/`. Schema verificato rispetto all'attuale motore `bd formula` / `bd cook` / `bd mol pour` (tutti i 14 deliverable — 13 template + README — confermati come parsing + cooking corretti con sostituzione variabili).

### 13.1 Catalogo (tutti i 13)

Catalogo vs substrate §6.9.10: substrate nomina **sei archetipi** come minimo; il runtime distribuisce il catalogo più ampio basato su evidenza riportato sotto. Contrassegnati **A** = uno dei sei archetipi substrate; **D** = catena deliberativa/manutenzione (realizza i tipi di issue deliberativi substrate §6.9.8, si chiude con un outcome `decided` / artifact piuttosto che un diff di codice). Il ciclo di promozione §6.9.4 mette in relazione i due: le catene deliberative che ricorrono diventano archetipi.

| File | Classe | Step | Ruoli | Caso d'uso |
|---|---|---|---|---|
| `code-quick.formula.json` | A | 2 | reviewer | Modifica banale a basso impatto LOW |
| `code-standard.formula.json` | A | 5 | executor, code-sanity, obligations-scanner, reviewer | Default per diff di produzione (pipeline Iron) |
| `code-with-advisors.formula.json` | A | 8 | + parallelo explorer/researcher/overthinker prima dell'executor | Impatto HIGH/CRITICAL, approccio sconosciuto |
| `debug.formula.json` | A | 5 | debugger (non-skippable), code-sanity, obligations-scanner, reviewer | Bug fix |
| `security-deep.formula.json` | A | 7 | security-auditor (×2: advisor + gate), executor, code-sanity, obligations-scanner, reviewer | Superficie sensibile — valida anche indipendentemente il "medesimo ruolo a due classi" substrate §6.9.10 |
| `release-prep.formula.json` | D | 3 | changelog-drafter, changelog-keeper | Riconciliazione release [Unreleased] |
| `triage.formula.json` | D | 3 | explorer, overthinker | Salute della board |
| `research-only.formula.json` | D | 2 | `{{specialist}}` (default explorer; override researcher) | Pura investigazione |
| `restitch.formula.json` | A | 4 | debugger, code-sanity, reviewer | Recovery da conflitti (sesto archetipo) |
| `planning.formula.json` | D | 2 | planner | Iniziativa vaga → board per fasi |
| `premortem.formula.json` | D | 2 | overthinker | Avvocato del diavolo prima di design rischioso |
| `doc-sync.formula.json` | D | 2 | sync-docs | Aggiornamento drift documento singolo |
| `memory-hygiene.formula.json` | D | 2 | memory-processor | Consolidamento memoria obsoleta |

### 13.2 Risultati critici sullo schema (verificati rispetto al binario bd)

- **Formato file:** `.formula.json` (TOML anch'esso supportato). YAML deprecato (changelog: "Formula format YAML→JSON").
- **Il campo top-level è `formula` (non `name`).** L'errore di validazione dice "name is required" ma la chiave JSON è `formula`.
- **`version` è INT, `extends` è array** (stringa singola fallisce il parse).
- **`vars` è una mappa**, non array: `{ "var": { "default": "...", "required": false } }`.
- **Per-step:** `id` (richiesto), `title` (richiesto, supporta `{{var}}`), `type` (tipo issue bd), `needs` (dipendenze → diventa arco `blocks`), `description` (multi-linea, supporta `{{var}}`), `labels` (array).
- **Il matcher `applies_when` NON è supportato come campo formula** — silenziosamente droppato. La logica di selezione risiede nell'hook Claude §4 + dispatcher `sp chain review` esternamente. **Un solo linguaggio di matching in tutto il sistema** rimane valido, applicato al layer di selezione.

### 13.3 Catena ≡ bd `molecule` (raffinamento di §1.1.1)

Il modello mentale §1.1.1 è stato raffinato in **catena ≡ bd molecule** (questa sezione è ora la fonte canonica): `bd mol pour <formula>` crea un genitore `issue_type=molecule` (NON epic) con step come figli tramite archi `parent-child` + archi `blocks` tra fratelli per `needs`. La molecola È l'identità della catena. Epic rimane il *genitore organizzativo sopra le catene*.

Funzionalmente identico a epic-con-figli (entrambi producono genitore + figlio + archi parent-child) ma bd ha un tipo dedicato `molecule` per gli output di pour. Per migrazione substrate: `bd molecule` → substrate container `kind: chain`; trasferimento strutturale, semantica preservata.

Per annidare una catena dentro un epic organizzativo: `bd dep add <molecule-id> <organizational-epic-id> --type parent-child` dopo il pour.

### 13.4 Helper post-pour per edge-wiring (Opzione B confermata)

Il campo `needs` produce solo archi `blocks-on`. Gli archi semantici dall'Opportunità 5 (`validates`, `informs`, `discovered-from`) sono codificati negli `labels` degli step come `edge:<type>-><target>`. Uno script helper legge le label post-pour e applica il corretto `bd dep add <step> <target> --type <type>`. Pseudocodice + spec in `docs/design/chain-templates/README.md` §"Post-pour helper".

Costo di implementazione: ~50 LOC shell o node. Idempotente (bd dep add deduplica). L'helper sarà implementato come parte della Fase 2 del rollout master (§10.2) — chiamato da `sp chain review` immediatamente dopo il pour.

### 13.5 Pattern di estensione per-repo

bd formula `extends: ["parent-formula"]` (array, non stringa) appende gli step del genitore + gli step figlio. Esempio da market-data (documentato nel README):

```jsonc
// ~/projects/mercury/market-data/.beads/formulas/quant-validation.formula.json
{
  "formula": "quant-validation",
  "extends": ["code-with-advisors"],
  "steps": [
    { "id": "quant-methodologist", "title": "quant-methodologist:{{root_title}}", "needs": ["root"], ... }
  ]
}
```
**Nota:** `extends` AGGIUNGE — i passaggi figlio vengono DOPO i passaggi padre nella forma della catena risultante. Per posizionare un advisor personalizzato PRIMA dell'executor (es. quant-methodologist prima dell'executor in code-with-advisors), il `needs` del passaggio aggiunto dal figlio controlla solo il proprio ordinamento, ma l'executor del padre mantiene comunque il suo `needs` originale. Due soluzioni alternative:
- (a) Non usare extends — duplicare la catena completa con i ruoli personalizzati inseriti nelle posizioni corrette
- (b) Usare extends ma affidarsi alla dipendenza esistente dell'executor del padre dagli advisor; se il tuo advisor personalizzato non compare nei needs dell'executor, l'executor verrà dispatchato prima di esso (probabilmente non desiderato)

Per l'estensione per-repo che necessita di inserire advisor prima dell'executor, l'opzione (a) è più sicura. Abbiamo scelto (a) per il catalogo predefinito (senza extends) per prevedibilità.

### 13.6 Cosa deve ancora essere implementato

- **`sp chain wire-edges <molecule-id>`** helper (~50 LOC). Fase 2 del rollout master.
- **Hook Claude su `bd create` proposta template** (§4) necessita dei percorsi del file di catalogo template da suggerire. Fase 1.
- **`sp chain review <bead>`** (Opportunità 4) dispatcha `bd cook` + `bd mol pour` + `sp chain wire-edges` come unica operazione composta. Fase 2.
- **Meccanismo di distribuzione:** copiare `docs/design/chain-templates/*.formula.json` in `~/.beads/formulas/` tramite `xt init` / `xt update`. Oppure in per-repo `<repo>/.beads/formulas/` dietro un flag.

### 13.7 Aggiornamento matrice di cross-reference

Le matrici Appendix friction → patches e asymmetry → patches rimangono valide. I template chiudono ulteriori pattern di attrito (dalle scoperte dell'explorer):

| Attrito (pre-template) | Chiuso dal template |
|---|---|
| Reviewer saltato su diff banale | `code-quick` (reviewer strutturalmente non-saltabile) |
| Explorer dimenticato su blast HIGH | `code-with-advisors` (3 advisor paralleli prima dell'executor) |
| Debugger dimenticato su bug | `debug` (debugger come opener non-saltabile) |
| Overthinker mai dispatchato | `triage` + `premortem` + `code-with-advisors` (overthinker presente in 3 template) |
| Researcher mai dispatchato | `code-with-advisors` + `research-only` (researcher presente) |
| Riempimento manuale changelog | `release-prep` (drafter → keeper automatizzato) |
| Triage ad-hoc | Template `triage` (explorer → overthinker) |
| Indagine scrive codice accidentalmente | `research-only` (label scope-empty:code + NON_GOALS applica) |
| Fallback manuale git dopo fallimento sp merge | `restitch` (flusso di recovery pulito) |
| Intent di planning perso | `planning` (planner da solo, output è bd issue board) |
| Design rischioso committato senza devil's-advocate | `premortem` (overthinker da solo, type=decision) |
| Deriva doc si accumula | `doc-sync` (aggiornamento drift single-doc) |
| Memoria stale inquina sessioni future | `memory-hygiene` (consolidamento memory-processor) |
