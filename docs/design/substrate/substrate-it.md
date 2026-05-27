# Substrate: Container, Issue e ciclo di vita del Seed

> **Stato:** Bozza (revisione 10). Consolida rev9 più: chain-coordinator come giudice permanente di un container transitorio (§4.3); accesso alla memoria come capacità del partecipante + distillazione del chain-coordinator alla chiusura (§10.2, ruolo memory-curator eliminato); chain-template dichiara il proprio modello coordinator (§6.9.10). Consolidamento precedente (rev9): modello container (ciclo di vita astratto, cinque tipi incl. seed + node), preflight-as-seed-container, nuovo sistema issue (tre percorsi di creazione, validatore a due stadi, contratti step-issue), sistema di relazioni tra issue, chain template + composizione (worktree lease, modello git a due assi), channels (ex conversations, v0–v3), astrazione participant + superficie SDK, emitter/pulse, recovery dei failure, tether (ex shepherd), contract validator, memoria a tre assi, matrice collisioni, scrutiny/obligations/ddiff (ispirato a Iron), coesistenza container-channel, context-depth, provenienza/ownership, modello dati single-store, dashboard, superficie API.
>
> **Ambito:** Definisce l’architettura runtime per il lavoro agent-native nel progetto `xtrm`. Sostituisce le pratiche tribali dell’orchestrator con entità nominate, osservabili e riproducibili. Progettato affinché orchestrator, node-coordinator e umano leggano tutti la stessa superficie runtime.
>
> **Non-obiettivo:** Specifica API a livello endpoint; contenuto dei prompt specialist. Il target di design è il runtime e i suoi store. L’attuale materiale sp + bd + GitHub materializer è **usa e getta** — substrate definisce una API pulita e i consumer vi si conformano; non portiamo avanti il vecchio debito di integrazione.

## Layout del progetto

`xtrm` è solo il nome del progetto ombrello (non un binario). È un **monorepo** di cinque package, pubblicati come package npm separati, che si importano a vicenda dentro il repo dove qualcosa viene riutilizzato.

| Package | Binario | Possiede (codice + schema) |
|---|---|---|
| **core** (ex `xtrm-tools`) | `xt` | Bootstrap del progetto, gestione worktree, install / update / doctor |
| **substrate** | `sb` | Issues, containers, plans, collisions, validator, pulse/triggers, provenance/ownership, memory |
| **channels** | lib (+ `ch`) | La primitiva channel: messages, subscriptions, reducer/after-hook, authority, participant subscription |
| **specialists** | `sp` | Specialist run, job lifecycle, tether, telemetry |
| **console** | — (web app) | La dashboard (read-only) |

La direzione delle dipendenze è aciclica: console → {all}; specialists → {channels, substrate, core}; substrate → {channels, core}; channels → {} (standalone — una primitiva di messaging pura che non sa nulla dei worktree, quindi resta massimamente riutilizzabile); core → {}.

**Uno store, un daemon, un socket.** Nonostante i cinque package, il *runtime* è un singolo database SQLite (WAL) servito da un daemon su un unico Unix socket: `~/.xtrm/state.db`. Il design multi-store precedente (DB `.sb`/`.sp` separati) viene abbandonato — xtrm espone la propria API (la console e i nostri tool sono i suoi primi consumer), quindi l’API è la superficie di separazione, non i file su disco. Un db, un processo, un riferimento è più semplice da usare e rimuove le modalità di fallimento da coordinamento inter-daemon.

La separazione che conta è **ownership nel codice, non separazione dei file**: ogni package possiede lo schema delle proprie tabelle ed è l’unico codice che le scrive. Le tabelle sono namespaced per dominio (`containers`/`issues`/… sono di substrate; `channel_*` sono di channels; `jobs`/`runner_events`/… sono di specialists). Un utente che non usa una parte del sistema ha semplicemente tabelle vuote — costo zero. La disciplina **nessuna foreign key tra domini; correlazione solo tramite ID opaco** viene mantenuta anche se è un solo db — è ciò che permette agli store di essere ri-separati in futuro (sharding, un futuro in cui specialists gira su una macchina diversa) senza redesign. Il meglio di entrambi: separazione nel codice, semplicità di un solo store a runtime.

La CLI non espone mai il nome del package (`xt skills update`, non `xt core skills update`).

---

## 1. Problema

Oggi il runtime espone job individuali (`sp run`, `sp ps`, `sp feed`) ma le unità di lavoro su cui l’orchestrator ragiona davvero — *chains*, *epics*, *waves*, *preflight planning*, *collisions tra worktree* — sono pratiche tribali, non entità. L’orchestrator porta questo stato nella propria testa. La dashboard lo ricostruisce facendo grep sugli eventi. La qualità varia enormemente tra sessioni.

Fallimenti concreti osservati in run reali:

- **Le chains sono implicite.** `sp run executor` crea un job e un worktree. Dispatch successivi di reviewer/sanity/security si uniscono alla "stessa chain" solo per convenzione. Nulla nel sistema nomina la chain. Non puoi fare `sb container ps chain:X` per vedere cosa c’è dentro.
- **Il preflight è discrezionale.** "Questa issue è un contratto utilizzabile? Dovremmo consultare overthinker prima? C’è una memoria che vale la pena richiamare?" — tutto vive nella disciplina dell’orchestrator. Le mancanze sono silenziose.
- **Le collisioni emergono all’integrazione.** Quando 8 chains toccano lo stesso file, lo scopri al momento del cherry-pick, ~6 ore dopo che il conflitto è diventato inevitabile.
- **Il richiamo della memoria è text-match-on-issue.** FTS5 sul contenuto dell’issue scatta sulla presenza di token, non sulla rilevanza. L’iniezione mid-run di Tether è troppo tardiva se la memoria rilevante avrebbe cambiato il piano.
- **Le issue sono prosa.** La qualità degli specialist è limitata dalla qualità dell’issue, e "qualità dell’issue" è qualunque prosa l’operatore abbia digitato. Nessun gate strutturale.

La soluzione non è una dashboard migliore. La soluzione è rendere le entità mancanti **reali nel runtime**, con ID stabili, cicli di vita e superfici CLI. La dashboard diventa allora un renderer sottile sopra lo stato runtime.

---

## 2. Modello concettuale

Il sistema è costruito da un piccolo insieme di primitive. Container e le cose al loro interno, più i segnali che scorrono tra loro.

### 2.1 Entità

| Entità | Cos’è | Prefisso ID |
|---|---|---|
| **Container** | L’unità di lavoro. Cinque tipi (§4). Ha il ciclo di vita astratto (§3), un channel, membri, un budget. | `seed:`, `chain:`, `epic:`, `wave:`, `node:` |
| **Issue** | Contratto di lavoro strutturato (sostituisce bd issue). Di proprietà di un container. | `iss-` |
| **Participant** | Un membro di un container: si sottoscrive al suo channel, reagisce agli eventi. Uno specialist è un *tipo* di participant (§2.2). | (chiave sul container) |
| **Channel** | Stream di messaggi append-only, sottoscrivibile, scoped a un container (ex "conversation"). | uguale all’ID container |
| **Pulse** | Un segnale — `trigger | job | message` — emesso da un emitter, che porta una idempotency key (§2.3). | `pulse-` (hash) |
| **Emitter** | Un attore registrato che emette pulses, sotto una capability dichiarata (§2.3). | (chiave registrata) |
| **Plan artifact** | Output strutturato di un seed container; il contratto tra pianificazione ed esecuzione. | `plan-` |
| **Tether** | Sidecar always-on che inietta hint scoped nel prossimo turno di prompt di un job. | (per-job) |
| **Validator** | Gate a due stadi sulla readiness del contratto issue: programmatic sempre, agentic on demand (§6.3). | (per-issue) |
| **Memory** | Un fatto durevole, cross-task, con metadata; interrogato a tre livelli (§10). | `mem-` |

Gli ID usano un **separatore due punti** (`chain:7f3a`, `node:research`) perché l’ID di un container *è* l’ID del workstream del suo channel (§7), quindi devono essere lo stesso token. I sub-stream gerarchici si annidano con `/` (`node:n1/sub:ab12`).

### 2.2 Participant — uno specialist è un tipo, non l’unico

Un membro di un container è un **participant**: qualcosa che si sottoscrive al channel del container e reagisce ai suoi eventi. Uno specialist (agente guidato da LLM) è *un tipo* di participant. Altri:

| Tipo participant | Cos’è | Ha context window / costo token |
|---|---|---|
| `specialist` | Agente LLM (executor, reviewer, …) | sì |
| `script` | Helper deterministico che reagisce agli eventi channel | no |
| `service` | Processo deterministico long-running | no |
| `coordinator` | Il giudice/owner di un node o seed | sì (LLM) |
| `external` | Un adapter per una sorgente esterna (webhook, ecc.) | no |

Uno script helper sottoscritto a `verdict:*` che tocca un file a ogni PASS è un membro completo del container — si sottoscrive, reagisce, può emettere pulses — senza context window e senza costo token. Il meccanismo di subscription appartiene al **channel**, non allo specialist (§7.1), quindi ogni tipo participant si integra nello stesso modo. Questa è la giuntura SDK (§2.4): il blocco `channel` in un `.specialist.json` è in realtà una *participant definition*, di cui `.specialist.json` / `.script.json` / `.service.json` sono varianti per tipo.
### 2.3 Emitters e pulses — il livello del segnale

Un **emitter** è un attore registrato con la capacità di emettere **pulses**. Un pulse è uno di tre segnali: `trigger` (svegliare/aprire un container), `job` (dispatch del lavoro), `message` (postare su un channel). I pulses portano una **idempotency key** (`<source>:<entity>:<event>`, es. `github:pr-50:opened`); substrate deduplica su di essa (§ pulse handling), quindi un webhook duplicato è un no-op, non un secondo container.

Emitters e participants sono ortogonali ma spesso coincidono: un participant `script` che reagisce *ed* emette è entrambi; un adapter webhook `external` emette senza essere membro di alcun container; un participant `system` può reagire senza emettere. La capability di un emitter — `can_emit: { pulse_kinds, budget, escalate_when }` — è **lo stesso meccanismo** della autonomy policy di un node e della capability `can_open_containers` di un container. Un solo capability model, non tre.

### 2.4 La superficie SDK

Queste primitive sono un SDK riutilizzabile, non machinery specifica di specialist. Costruire un nuovo actor significa compilare uno schema per un nuovo kind participant/emitter — non scrivere nuovo runtime:

- **participant definition** — `{ kind, channel: { subscribes, emits, wakes_on }, capability: { can_emit, budget, escalate_when } }`. `.specialist.json` è una variante.
- **pulse** — il segnale + la sua idempotency key.
- **channel client** — `post / readSince / markSeen / capture` + la procedura di authority (§7), usato in modo identico da ogni participant (uno script usa lo stesso client di uno specialist).
- **command surface** — query / change-feed / command (§17), ciò contro cui agisce ogni emitter.

### 2.5 Cosa NON è un container

Ci sono esattamente cinque container kinds (§4) — `seed`, `chain`, `epic`, `wave`, `node` — e **nient’altro è un container.** Una cosa è un container solo se ha l’abstract lifecycle (§3) e può avere members/children. Esplicitamente non sono container: **emitter** (un attore registrato), **pulse** (un segnale), **job / specialist run** (un’esecuzione *dentro* una chain, posseduta da essa), **issue** (un work contract *posseduto da* un container), **channel** (la communication surface di un container, stesso ID ma non un container ricorsivo), **participant** (un membro, non un container), e **plan / journal / node-state** (artefatti prodotti dai container). Questo confine conta per l’SDK: impedisce un futuro "container:pulse."

### 2.6 Tre assi su ogni container

bd li conflava; substrate li tiene separati perché rispondono a domande diverse e hanno mutabilità diversa.

- **Membership** — `parent_id`. In quale container vivo. Una proprietà; strutturale; può essere null.
- **Provenance** — `opened_by`, `opened_reason`, `origin_chain`. Chi ha compiuto l’atto di aprirmi, e perché. Storico; **immutabile**; l’intera chain fino alla root è ricostruibile seguendo `opened_by`.
- **Ownership** — `owned_by`. Chi è responsabile di me *adesso*. **Mutabile** — questo è il punto. Un node muore, l’ownership dei suoi children live viene trasferita (di default all’orchestrator) senza riscrivere la provenance. Il trasferimento di ownership è anche un’azione esplicita: un node può `escalate ownership` di un child che non riesce più a gestire.

Due facilities trasversali si attaccano ai container: la **collision matrix** (live `git diff` incrociato per overlap, §9) e **memory** (§10) — accessibili come capability da ogni participant, distillate alla chiusura dal chain coordinator.

**Ownership note (cosa è passato da sp a substrate).** I container — inclusi gli epic — sono concetti substrate. Oggi `sp` possiede l’orchestrazione epic (`sp epic status/merge`) perché bd-parent-of-children era l’unica primitiva di grouping. Con substrate il *container* è la primitiva di grouping. Quindi `sp epic` viene rimosso; substrate possiede container state, edges e merge. `sp` mantiene ciò in cui è bravo: eseguire un singolo job e la sua comunicazione live (`sp run`, `sp ps` per jobs, `sp feed`, `sp tail`, `sp tether`). La divisione: **substrate possiede *quale lavoro esiste e come viene raggruppato, sequenziato e merged*; specialists possiede *l’esecuzione di un job*.**

---

## 3. Il container lifecycle

Ogni container — una chain con una issue, un node long-running, un planning seed — esegue lo **stesso abstract lifecycle**. Questa astrazione è deliberata: è ciò che rende il sistema adattabile a workflow non di coding e a kinds che non abbiamo ancora inventato. Dashboard, CLI e observability surfaces vedono una sola shape; il *kind* decide cosa significhi concretamente ogni abstract state.

```
open ──► working ──► converging ──► ready ──► closed
                          │                       
                          ▼                       
                      escalated   (suspends; from any non-terminal state)
```

| Abstract state | Significato |
|---|---|
| `open` | Container creato, members/channel in cablaggio; non sta ancora facendo il suo lavoro. |
| `working` | Il container sta facendo il lavoro del suo kind. |
| `converging` | Il lavoro si sta chiudendo; un judge/reviewer sta decidendo l’esito. |
| `ready` | Il deliverable del container è pronto (un plan, una diff mergeable, …). |
| `closed` | Terminale. Il kind decide la concrete close reason (`merged`/`abandoned`/`transformed`/`retired`/`failed` — §5.10). |
| `escalated` | Serve una decisione dell’operator (o owner); sospeso; rientra in qualsiasi non-terminal state. Un semantic failure (§5.10) atterra qui prima, worktree ed evidence preservati. |

Ogni kind mappa gli abstract states su stati concreti:

| Kind | `working` | `converging` | `ready` | `closed` | apre containers? | standing? |
|---|---|---|---|---|---|---|
| `seed` | advisors conversano | judge sintetizza plan | plan ready | **transformed** (ha aperto il final container) | **sì** — è il suo scopo | no |
| `chain` | executor + review active | reviewer scoring | merge_ready | merged / abandoned | no | no |
| `epic` | child chains active | tutti i children converging | tutti merge_ready | merged / abandoned | no (i children sono membership) | no |
| `wave` | parallel issues active | per-issue review | tutti PASS | merged / abandoned | no | no |
| `node` | continuous work (il normale stato long-term) | (raggiunto raramente) | (raggiunto raramente) | retired | **sì** — apre child containers | **sì** |

Due cose ne derivano in modo pulito. La reason `closed` di un **seed** è `transformed` — il suo "merge" *è* l’atto di aprire il final container che ha prodotto (che porta `opened_by = seed:…`). Un **node** vive in `working` per settimane e apre children da lì; non "finisce" — viene `paused` o `retired`. Stesso lifecycle, stesso runtime (channel, budget, escalation, members), identità e capability diverse.

**Il PARTIAL loop è ddiff-scoped.** Per task-shaped kinds, quando `converging` ricade a `working` su un verdict PARTIAL, la re-review è scoped al delta dall’ultimo verdict del reviewer (diff-of-diffs); le approvazioni precedenti per sezioni non toccate vengono mantenute. Questo è il concetto Iron "ddiff" (§6.6) — un delta check, non un full re-audit.

**Due families.** I *Transient* (`seed`, `chain`, `epic`, `wave`) raggiungono `ready` poi `closed` — finiscono. Lo *Standing* (`node`) vive in `working` e apre transient containers come parte del proprio lavoro — non completa, è `paused`/`retired`. La capability `can_open_containers` (detenuta da `seed` e `node`) è ciò che consente a un container di aprirne un altro; tutto ciò che "apre un container" riusa un solo runtime path, scrivendo provenance sul child (§2.6) — nessuna duplicazione per-kind.

**L’avanzamento è template-driven, non orchestrator-driven.** Dentro una chain, l’avanzamento step-to-step (executor → gates → reviewer → merge_ready) è guidato dal chain_template risolto della chain (§6.9), eseguito dal lifecycle di substrate, *osservato* dall’orchestrator. L’orchestrator apre la chain e guarda; non avvia ogni step a mano. Questo è deliberato — il dispatch step-by-step come discrezione dell’orchestrator è dove il sistema diventa pigro (reviewer saltati, debugger dimenticati). L’orchestrator mantiene ogni potere di intervenire (steer, pause, inject a member, override, escalate) e perde solo il dovere di guidare gli step di routine.

### 3.1 Cosa fa avanzare un container — allineamento con il runtime pi

Specialists gira sul runtime pi-coding-agent, che ha già la struttura assunta dal lifecycle di substrate. Verificato contro il runtime (`runner.ts` / `supervisor.ts` / `pi-rpc.md`), substrate si allinea ai beat esistenti di pi invece di inventare un clock parallelo. Quattro fatti stabiliscono come avanza davvero un container:

- **Nessun clock "tick" separato — l’avanzamento è event-driven.** Il reducer di un container scatta solo su tre triggers: `turn_end` / `agent_end` di un member (attività live dentro il container), arrivo di un pulse (external trigger), o un comando esplicito `sb` (operator action). Substrate fa avanzare containers e chains **da evidence persistita o pulses equivalenti — mai da un wall-clock tick e mai da testo visto in uno stream live.** Un PASS emesso in un initial run, un resume turn, o un channel verdict diventano tutti la stessa durable `verdict` evidence prima che qualcosa avanzi. (Questo è ciò che rende solido il completeness contract di §6.9.2: un gate è `done` solo quando la sua evidence è persistita e soddisfa, non quando il suo process ha casualmente stampato "OK".) **Una refinement per le chains:** il dispatch del first step aspetta non solo `sb chain approve` ma anche il `verdict: ready` del chain coordinator (§4.3) — il coordinator è un fresh-context entry gate che può inserire steps entro policy prima che la chain giri. Gli step successivi avanzano su `agent_end` dello step precedente come prima.

- **`waiting` = pi keep-alive dopo `agent_end`.** `agent_end` di Pi è la job-level quiescence barrier; in keep-alive mode la sessione resta resumable. Il work-state `waiting` di Substrate mappa 1:1 su questo — non viene inventato un nuovo stato. Il writer di uno step che rilascia il worktree lease (§6.9.6) su `done`/`waiting` *è* questa barrier. La resume injection (uno steer/redirect mid-flight) usa il comando `steer` esistente di pi, che consegna dopo i tool calls del turno corrente e prima della successiva model call — il punto di injection idempotente di cui ha bisogno un channel after-hook (§7).

- **Il daemon è un secondo reader della telemetry esistente — nessun nuovo hook.** Tutto ciò che il daemon deve osservare per avanzare e recuperare (process termination, exit codes, compaction signals, non-progress) è già cablato attraverso lo observability stream del runtime (le righe lette da `sp log`). I lifecycle pulses di §5.8 (`specialist.spawned` / `turn-complete` / `waiting` / `compacted` / `stopped`) vengono emessi *come side effect della scrittura di quelle righe*; `specialist.compacted` è letteralmente la receipt di `auto_compaction_end` di pi. Il daemon non aggiunge instrumentation — si sottoscrive al bus che il supervisor già scrive.

- **`transient` failure = qualunque cosa pi abbia auto-retried.** La classe transient di §5.10 è ancorata a un runtime envelope concreto: pi classifica già overload/5xx/rate-limit/OOM tramite i suoi eventi `auto_retry_*`. La transient class di Substrate *è* quell’envelope — non un giudizio separato. Semantic failure è il caso ortogonale che il runtime non può auto-classificare, rilevato dai non-progress counters (§5.10).

Questi risolvono le due runtime questions che §14.1 aveva segnalato per il next agent (il concetto di turn; se daemon-observes si adatta) — il turn di pi è l’heartbeat, e allinearsi a esso è la scelta.
## 4. Tipi di container

Cinque tipi, in due famiglie. I tipi transitori finiscono; il tipo permanente persiste.

| Kind | Family | Trigger | Shape | Outcome |
|---|---|---|---|---|
| `seed` | transient | Un intento di pianificazione (precedentemente "preflight") | Gli advisor conversano, il giudice sintetizza un piano | Si trasforma nel container finale che ha prodotto |
| `chain` | transient | Il piano ha 1 issue | Lineare: exec → ?sanity → ?security → reviewer | `sb container merge` |
| `epic` | transient | Il piano ha N issue con archi di dipendenza + parent condiviso | DAG; le chain girano in serie / parallelo secondo la strategia del cluster | `sb container merge` — batch in ordine topologico |
| `wave` | transient | Il piano ha N issue indipendenti per esecuzione parallela | Piatta; ogni issue genera la propria sub-chain | `sb container merge` — per issue man mano che PASSa |
| `node` | **standing** | Un mandato di lunga durata (ricerca, monitoraggio, manutenzione, scraping, marketing, watch di PR/issue…) | Un coordinator gira continuamente con alta autonomia; apre container figli quando il lavoro lo richiede | Non "finisce" mai — `paused` / `retired` |

Una wave è "un epic senza archi di dipendenza" — tipo separato perché permette scheduling parallel-first e merge per-issue senza batching.

### 4.1 Seed — il container di pianificazione (era "preflight")

`seed` è un tipo di container di prima classe il cui scopo è **decidere la forma del lavoro e produrre il container reale.** Si apre, i suoi membri (advisor) conversano nel suo channel, un giudice sintetizza un artifact `plan`, e dopo l'approvazione il seed **si trasforma** — apre il container finale (`chain`/`epic`/`wave`, oppure consegna un mandato a un `node`), che porta `opened_by = seed:…`, e il seed si chiude con reason `transformed`. Il seed non è un prologo speciale con regole proprie; è un container che riusa l'intero runtime (lifecycle, channel, budget, escalation, members) e il cui *output* è un altro container. Dettaglio completo in §5.

### 4.2 Node — il container permanente e autonomo

Un `node` genera un **coordinator** (un partecipante LLM) che gestisce un workgroup nel lungo periodo con alta autonomia e poco intervento dell'orchestrator. A differenza dei container a forma di task, un node è *standing*: vive in `working`, dorme tra i trigger, si sveglia sugli eventi e apre container figli sotto la propria autorità. Esempi: un node che osserva le PR e apre una `chain` per gestirne ciascuna; un research node che apre `seed` per sotto-task ambigui; un maintenance node che gira su schedule.

Proprietà chiave (dettaglio in §5.8–§5.9):

- **Autonomy policy = capability.** Il coordinator apre figli entro una policy dichiarata (`max_open_children`, `budget_per_period`, `allowed_kinds`, `escalate_when`). Entro la policy agisce da solo; oltre, escala invece di agire. "Poco intervento" è preciso: intervieni solo oltre la policy.
- **Il coordinator è lo scheduler dei propri figli.** Il daemon consegna i wake (e applica rate-limit / coalescing *meccanici* — §5.8); il coordinator decide *semanticamente* se mettere in coda, eseguire in serie o eseguire in parallelo.
- **Il coordinator è stateless rispetto al node.** Lo stato del node vive nel container (§5.9), quindi un coordinator può essere ucciso e respawnato in sicurezza (deve esserlo, per motivi di context-window — §5.9).
- **`seed` vs dispatch diretto è per-node.** Un node ben specificato apre chain direttamente (nessun overhead deliberativo); un node ad-hoc a cui viene affidato un mandato ambiguo apre un `seed` (deve prima scoprire la forma). Campo capability `dispatch_mode: direct | via_seed` (o un predicate).
- **Node-opens-node è gated.** Un node può aprire liberamente figli transitori entro policy, ma aprire un altro node *standing* richiede escalation (un albero auto-spawnante di node standing esaurisce risorse silenziosamente). Depth-capped. I coordinator di node peer collaborano tramite **cross-container pulses** (§2.3), non channel — i channel sono scoped al container (channels.md mantiene la messaggistica cross-channel fuori scope), quindi un peer emette un pulse su una key documentata e il node ricevente si sveglia su di esso. Questo riusa la primitiva pulse invece di estendere il channel; è la realizzazione dell'idea a lungo rinviata di "epic-level coordinator".

### 4.3 Chain coordinator — il giudice permanente di un container transitorio

Una chain ha un coordinator, parallelo nella forma a quello di un node (§4.2) ma scoped a una sola chain. È **un partecipante del channel della chain**, spawnato al completamento della composition — dopo `sb chain approve` ma **prima che il daemon dispatchi step-1**. Svolge quattro ruoli durante la vita della chain (entry gate, borderline judge, hygiene coordinator, close-time judge) ed è subordinato all'orchestrator: agisce entro la sua policy `autonomy_json` (stessa forma di quella di un node, §5.8) ed escala oltre. Dove il node coordinator è il cervello permanente di un container di lunga durata, il chain coordinator è il cervello permanente di uno transitorio — contesto fresco, scoped alla vita di questa chain, muore con essa.

**Perché esiste.** Una chain che avanza template-driven (§6.9.1) è osservata dall'orchestrator ma non rappresentata dall'interno. Il reducer (§3.1) avanza su evidenza meccanica; non può giudicare ambiguità (un gate con findings minori — accettarli come non_goals o rieseguire?), non può proporre issue followup da finding emergenti, non può verificare "git is clean for real" oltre un controllo porcelain. Il coordinator riempie esattamente quel vuoto a forma di giudizio, e lo fa con **contesto fresco** — si è appena svegliato in questa chain, non appesantito dal carry-over di sessione dell'orchestrator, vedendo l'issue in modo pulito. Due giudici, scope distinti: l'orchestrator possiede la *visione* (cosa fare, dato tutto ciò che è in flight); il chain coordinator possiede *meccaniche e giudizio intra-chain* (questa forma di chain ha senso dall'interno, questa evidenza soddisfa, quale igiene serve).

**Quattro ruoli.**

1. **Entry gate (pre-esecuzione).** Con contesto fresco, il coordinator valida la forma della chain dall'interno. Serve inserire qualcosa prima che step-1 giri — un explorer mancato dal planner, un methodologist per uno scope inaspettatamente insidioso? **Entro autonomy policy** chiama direttamente `sb chain insert` (§6.9.5); oltre, escala. Quando è soddisfatto emette un messaggio **`verdict: ready`** sul channel della chain, e solo allora il daemon dispatcha step-1. Questo è il piccolo affinamento a §3.1: il primo step di una chain non avanza dal solo `sb chain approve` — avanza da `sb chain approve` *più* il `verdict: ready` del coordinator.
2. **Borderline judge (durante l'esecuzione).** Il reducer di §6.10 esegue il controllo meccanico di close-readiness (predicate booleani su evidenza persistita). Il coordinator interpreta i casi che il reducer non può decidere da solo — "questo gate ha restituito FINDINGS ma sono minori e dentro `non_goals`," "questo riferimento di evidenza è ambiguo." Entro policy decide; oltre, escala come messaggio channel `proposal`/`escalation` che l'orchestrator raccoglie. Non duplica il reducer; riempie lo spazio di giudizio che il reducer lascia.
3. **Hygiene coordinator (cross-chain, via pulse).** I coordinator su chain parallele si inviano pulse (§2.3) per **igiene meccanica** — collision alert ("sto toccando file X"), annunci di gate-state ("code-sanity passato, evidenza Y disponibile"), richieste wait-for-me. La linea che deve reggere: **i pulse sono per meccaniche, mai per visione.** "Decidere quale approccio adottare" o "dovremmo abortire?" restano all'orchestrator. Il vocabolario pulse del coordinator è fatto di eventi di igiene documentati, non negoziazione aperta.
4. **Close-time judge (pre-merge).** Quando il reducer dice `close_ready`, il coordinator fa il closing pass: conferma o contesta la derivazione; verifica **git is clean *for real*** (non solo `git status --porcelain` pulito — ogni modifica prevista committata, branch nello stato dichiarato, nessun artifact vagante); **distilla memoria** dall'esito della chain — `type:failure` per fallimenti semantici (§5.10), `type:best_practice` per successi puliti — sostituendo il ruolo precedentemente svolto da un curator dedicato (§10.2); **propone issue `class: followup`** per finding emersi durante la chain ma caduti fuori dal suo scope (`sb issue create --rel discovered-from:<root>`, §6.7) — questi followup sono normali root issue, liberi di scalare in chain proprie più tardi se l'operator/orchestrator li promuove. Solo dopo questi passaggi il coordinator rilascia la chain a `sb container merge`. Qui il coordinator aggiunge più chiaramente valore che il reducer non può: giudizio su cosa è stato appreso, cosa resta dovuto, cosa vale la pena ricordare.

**Stesso accesso di qualsiasi partecipante — nessun read path privilegiato.** Il coordinator legge il channel della chain (live stream, §6.8) e interroga `issue.evidence_json` (il lato persistito durevole della dual-write, §6.8) — entrambe le viste sono disponibili a ogni partecipante; il coordinator usa il channel per coordinamento live durante l'esecuzione e l'evidenza persistita per query strutturate al close-time. Questo mantiene il replay log canonico e non dà al coordinator alcun canale speciale dentro substrate.

**Model selection — per chain_template.** Il coordinator è **sempre spawnato** per una chain (uniformità con il node coordinator, nessuna logica special-case), ma il model è **dichiarato sul chain_template** (§6.9.10). Default sensati: `code-quick` → small free-tier (o `null` per saltare del tutto il coordinator su lavori triviali); `code-standard` → mid-tier; `code-with-advisors` / `security-deep` / `quantitative-validation` → top-tier. L'operator può override per-chain. Questo calibra il costo al valore — giudizio premium dove conta, tocco più leggero dove il lavoro è strutturalmente delimitato — senza rendere la *presenza* di un coordinator una decisione di configurazione per-chain.

**Autonomia ed escalation.** Il chain container porta una policy `autonomy_json` accanto al suo `resolved_chain_json` (§13.3), con campi paralleli a quelli di un node (§5.8): `max_inserts`, `allowed_insertion_roles`, `max_followup_proposals`, `escalate_when`. Le azioni del coordinator dentro la policy sono autonome; oltre, escala all'orchestrator nello stesso modo in cui `escalated` funziona per qualsiasi container (§3). Un solo pattern di escalation per tutti i coordinator — node e chain.

**Allineamento del lifecycle.** La vita del coordinator è la vita della chain. Si spawna al completamento della composition, muore quando la chain raggiunge `closed` (il `sb container merge` che ha rilasciato, o `closed:failed` / `abandoned` su un failure path — nel qual caso la memoria di failure-distillation che avrebbe scritto diventa lavoro del meccanismo esistente di §5.10). Non journalizza attraverso le sessioni (le chain sono transitorie — nessuno stato di lunga durata da passare, a differenza del `coordinator_journal_json` di un node in §5.9). Contesto fresco, vita scoped.

### 4.4 Il merge è di substrate, e funziona

`sb container merge` è l'unico percorso canonico di pubblicazione per ogni tipo transitorio. Funziona — dove il vecchio `sp merge` / `sp epic merge` non funzionava — *perché substrate possiede il lifecycle del container e la worktree fork-base*. Il fallimento ricorrente di `sp merge` (merge sulla base sbagliata, friction bead `xtrm-nr05`) era un sintomo della logica di merge che viveva nel runtime specialist senza autorità su dove le chain forkavano. Substrate ha quell'autorità per costruzione: ha aperto il container, conosce la base di ogni chain, gatea `ready`. Il workaround provvisorio "manual cherry-pick is canonical, sp merge prohibited" (Iron epic) era una risposta al *vecchio percorso rotto*; sotto substrate non è necessario. `sp merge` / `sp epic merge` vengono rimossi, non aggirati. (Un node non ha merge finale — *apre* container transitori mergeable come parte del suo lavoro.)

**I container possono annidarsi.** `sb container ps --tree` mostra l'albero. Membership (`parent_id`) è distinta da provenance (`opened_by`) e ownership (`owned_by`) — §2.6.

---

## 5. Seed: pianificazione in profondità

Un `seed` è il container di pianificazione — precedentemente chiamato "preflight." È **un channel tra advisor**, scoped al container, che produce un artifact `plan.v1` e poi si trasforma nel container che ha pianificato. Poiché un seed è un container normale, tutto qui riusa il runtime standard (lifecycle §3, channel §7, budget, escalation, participants §2.2); solo i suoi membri (advisor) e il suo outcome (un piano, poi una transform) sono specifici del seed.

### 5.1 Entry

```
sb seed start --intent "..." [--from-issue iss-XXX]
  ↳ opens a seed: container in state `open`
  ↳ opens its channel (same ID) with topology=freeform, judge=seed-judge
  ↳ resolves advisor invite rules
  ↳ spawns invited advisors as participants → state `working`
```

O `--intent` (testo libero che gli advisor devono strutturare) oppure `--from-issue` (una issue esistente da rifinire/decomporre). Un seed può anche essere aperto da un node coordinator invece che da un umano (§5.8).

### 5.2 Regole di invito degli advisor

Gli advisor sono invitati in base a **regole che matchano l'intent o la proto-issue**, quindi il caso comune non richiede discrezione dell'orchestrator — anche se il panel è regolabile (sotto).

```yaml
# config/seed/invites.yaml
- advisor: devops-specialist
  invite_when:
    scope_matches: ["infra/**", ".github/workflows/**", "docker/**", "terraform/**"]
    or_tags_contain: ["infra", "ci", "deploy", "release"]

- advisor: security-auditor
  invite_when:
    scope_matches: ["**/auth/**", "**/secrets/**", "**/crypto/**"]
    or_intent_keywords: ["token", "credential", "permission", "auth"]

# l'accesso alla memoria non è più un advisor separato (§10.2) — è una capability che
# il planner e ogni altro partecipante porta tramite la memory-query extension.

- advisor: overthinker
  invite_when:
    risk_signals: ["cross-cutting", "design", "tradeoff"]
    or_estimated_issue_count_gte: 5

- advisor: researcher
  invite_when:
    intent_mentions_library: true   # rilevato tramite NER-lite
    or_intent_keywords: ["API", "framework", "library"]

- advisor: explorer
  invite_when:
    no_existing_context_for_scope: true
```

Il contract validator gira come advisor di default (sempre invitato; gatea l'approvazione del piano).

**Le regole sono una base, non l'intera storia.** Le regole di invito coprono i casi prevedibili, ma non possiamo enumerare ogni scenario, quindi l'insieme è regolabile a seed time:

- **L'orchestrator può aggiungere advisor non invitati dalla regola** ("questo sembra rischioso, coinvolgi comunque overthinker") postando `system.invite` sul channel. Può anche eseguire un seed con un set *minimale* — nel caso più semplice l'orchestrator è effettivamente l'unico advisor, deliberando da solo — quando il lavoro non giustifica un panel completo.
- **Alcuni advisor sono soft-mandatory** invece che rule-gated: il planner è invitato di default per la maggior parte dei seed perché il suo valore è quasi universale ed economico (l'accesso alla memoria è ora una capability che il planner porta, non un advisor separato — vedi §10.2), ma anche questo può essere waived per un seed triviale.
- **L'operator può suggerire advisor** interattivamente; l'orchestrator incorpora il suggerimento nell'invite set.

Il principio: le regole di invito danno un panel di default sensato senza discrezione dell'orchestrator per il caso comune, ma il panel non è congelato — l'orchestrator (e l'operator) lo regolano per seed, perché nessun set fisso di regole copre ogni tipo di lavoro.
### 5.3 Topologia dei canali

Un seed usa una **topologia freeform** (i membri si auto-eleggono a ogni tick), con un **seed-judge** che:

- Sottoscrive `finding`, `proposal`, `escalation`
- Pubblica `system.continue` mentre gli advisor stanno ancora producendo finding utili
- Pubblica `system.done` con l’artefatto di piano allegato
- Pubblica `system.redirect` se un membro devia fuori dallo scope del seed

### 5.4 Budget

Predefinito: `budget:turns=15`, `budget:wall=5min`, `idle:K=4`. Il judge chiude rigidamente a qualsiasi violazione. Sforare il budget è esso stesso un segnale — emerge come `seed_failed` con la ragione, e l’operatore riceve lo stato parziale per decidere se rieseguire con un intento più preciso o decomporre prima.

Costo previsto del seed: **sotto $0.05** su free-tier o modelli piccoli. La catena di modelli Tether-Layer-2 (Groq → Nvidia NIM → Ollama locale) gestisce i ruoli advisor che non necessitano di run specialist completi.

### 5.5 L’artefatto di piano

```jsonc
{
  "schema": "seed.plan.v1",
  "id": "plan-7f3a",
  "container_id": "chain:7f3a",      // assegnato all’apertura del seed; kind decisa all’approvazione
  "origin": {
    "trigger_issue_id": "iss-2yn4",
    "requester": "user|orchestrator|node-coordinator",
    "opened_at_ms": 1731000000000
  },

  "issue_set": [
    {
      "proposed_id": "seed-tmp-1",   // non ancora registrato nell’issue store
      "title": "...",
      "contract": {
        "problem":      "...",
        "scope":        ["cli/src/commands/install.ts", "cli/src/commands/update.ts"],
        "non_goals":    ["..."],
        "validation":   ["npm test --workspace cli", "..."],
        "acceptance":   ["comportamento osservabile 1", "..."],
        "scrutiny":     "low|medium|high|critical",
        "constraints":  ["..."]
      },
      "depends_on":      ["seed-tmp-2"],     // edge interni
      "role":          "executor",         // sulle step-issue generate
      "memory_pack":     ["mem-auth-redis-2026-03", "..."],
      "seed_risks":      [
        { "kind": "collision", "refs": {"files": ["install.ts"], "with_chains": ["chain:19e5"]} }
      ],
      "issue_local_rules": [
        "Non toccare sorgenti fuori da SCOPE.",
        "Preserva il comportamento DB-first; il fallback su file è solo legacy."
      ]
    }
    // ...altre issue proposte...
  ],

  "topology": {
    "kind": "chain|epic|wave",
    "ordering_rule": "topological|parallel|serial",
    "rationale": "Tre issue toccano install.ts; serializzare per evitare una tempesta di integrazione."
  },

  "collision_strategy": {
    "clusters": [
      {
        "files":       ["cli/src/commands/install.ts", "cli/src/commands/update.ts"],
        "chains":      ["chain:42in", "chain:19e5", "chain:9xg2.3"],
        "decision":    "serial",   // serial | unified | parallel-with-restitch
        "reason":      "Sovrapposizione a 3 vie su resolvePackageRoot; serializzare secondo memory <key>"
      }
    ]
  },

  "total_budget_estimate": {
    "dispatches":  12,
    "dollars":     0.85,
    "wall_minutes": 35
  },

  // persistito incrementalmente nel container del seed man mano che arrivano i finding (non solo all’approvazione),
  // così sopravvivono a un seed closed:failed e alimentano `sb seed rerun` (§5.10)
  "advisor_findings_log": [
    { "from": "planner", "kind": "finding", "summary": "2 memory rilevanti trovate tramite memory-query extension", "refs": {...} },
    { "from": "devops-specialist", "kind": "finding", "summary": "Richiede una issue separata per il gate CI", "refs": {...} },
    { "from": "overthinker", "kind": "proposal", "summary": "Decomporre in 3, non in 1", "refs": {...} }
  ],

  "budget_spent_in_seed": {
    "turns": 11,
    "wall_ms": 187000,
    "dollars": 0.018
  },

  "approval_state": "draft|approved|rejected|superseded",
  "approval_mode":  "auto|operator-gate|re-seed",
  "approval_at_ms": 1731000187000,
  "approval_actor": "orchestrator|user|<orchestrator-rule-id>"
}
```
### 5.6 Approvazione

Tre modalità, tutte risolvibili dall'orchestrator senza intervento umano quando le regole lo consentono:

| Modalità | Trigger | Azione |
|---|---|---|
| `auto` | Piano sotto la soglia di budget, nessun rischio seed `warning+`, nessuna collisione active-chain, nessuna escalation advisor | Commit degli issue nello store, apertura del container, dispatch della prima wave |
| `operator-gate` | Il piano supera il budget, tocca una superficie sensibile, contiene un rischio `blocker`, oppure una regola dice di chiedere | Piano pubblicato, dispatch bloccato; l'orchestrator continua il lavoro non correlato |
| `re-seed` | Qualsiasi issue proposto valida come `invalid`, il judge non converge, escalation attivata | La conversazione si riapre con redirect esplicito, oppure il container viene abbandonato |

Le regole vivono in `config/seed/approval.yaml`. Sono predicati sull'artefatto del piano. La modalità di approvazione è essa stessa un campo sull'artefatto.

### 5.7 Cosa fa commit-on-approval

All'approvazione, il runtime transazionalmente:

1. Crea issue nel nuovo issue store, sostituendo `seed-tmp-N` con ID reali `iss-NNNN`
2. Scrive gli edge di dipendenza dai campi `depends_on`
3. Marca ogni issue con il suo `memory_pack`, `issue_local_rules` e `role`
4. Decide il tipo di container da `topology.kind` e lo apre
5. Pianifica i dispatch della prima wave secondo `topology.ordering_rule` e `collision_strategy`
6. Trasforma il seed: apre il container finale (chain/epic/wave), che porta `opened_by=seed:<id>`; il seed si chiude con reason `transformed`

Un fallimento in qualsiasi passaggio fa rollback; il piano torna a `draft`.

### 5.8 Autonomia dei node, pulse e scheduling

Il coordinator di un node apre e guida child container sotto una **autonomy policy** — lo stesso capability model di un emitter (§2.3). La policy vive sul node container:

```jsonc
"autonomy": {
  "max_open_children":   5,
  "budget_per_period":   { "dollars": 10, "period": "day" },
  "allowed_kinds":       ["chain", "epic", "seed"],   // NON "node" — vedi sotto
  "dispatch_mode":       "direct" | "via_seed",        // oppure un predicate
  "escalate_when":       ["budget_exceeded", "ambiguous_mandate", "wants_standing_node"]
}
```

Dentro la policy il coordinator agisce da solo. Oltre essa, invece di agire **escalate** (apre un container `escalated` o posta sul canale dell'orchestrator). "Poco intervento" è preciso: intervieni solo oltre la policy. Aprire un altro node *standing* non è mai nella policy di default — richiede escalation, e il nesting dei node è depth-capped, perché un albero auto-spawning di standing node esaurisce risorse silenziosamente. I coordinator di peer node collaborano tramite **cross-container pulses** (§2.3) — un peer emette un pulse su una chiave documentata, il node ricevente si sveglia su di esso — invece che guardando i canali l'uno dell'altro (i canali sono container-scoped) o spawnandosi a vicenda.

**Comporre le chain che apre.** Quando un coordinator apre una chain (direttamente o tramite un seed), quella chain è composta come qualsiasi altra (§6.9.5): un chain_template si risolve, gli step-issue si materializzano, il composition gate sta a `open → working`. Il coordinator **auto-approva la composizione entro la sua autonomy policy** — questo è esattamente "agisce da solo entro policy" applicato alla forma della chain. Non si ferma per un `sb chain approve` umano; la sua policy *è* l'autorità di approvazione per le chain che apre, nello stesso modo in cui l'approvazione di piano `auto` (§5.6) consente alla prima wave di un seed di dispatcharsi da sola. Se la composizione fa emergere qualcosa oltre policy (un nudge L1 per una classe che la policy non permette, uno scrutiny level sopra il suo budget), escalate invece di auto-approvare — lo stesso confine graduato di tutto il resto che un node fa. Quindi le chain di un node sono completamente template-driven e gated (i mandatory gate si sovrappongono comunque, §6.9.3), ma il loro composition gate viene attraversato dalla policy del coordinator, non da un umano, nel caso autonomo.

**Trigger e pulse.** Un node dorme tra eventi e si sveglia su un **pulse** (§2.3) — un `trigger` da una schedule, una watch o una fonte esterna. Substrate possiede il wake: una tabella `triggers` (schedule tipo cron, o watch su un predicate) e una **FIFO pulse queue** per node. Il daemon fa solo scheduling **meccanico** — rate-limit (non più di N wake/period) e coalescing (10 eventi identici in una finestra non sono 10 wake). Poi consegna la queue al coordinator. Il **coordinator fa scheduling semantico**: legge la sua queue e decide l'ordine, se eseguire i children in parallelo o in serie, se un nuovo pulse aspetta che la chain corrente finisca. Il daemon protegge dagli hot loop; il coordinator prende le decisioni di lavoro. Nessuna sovrapposizione.

**Idempotenza.** Ogni pulse porta una idempotency key (`github:pr-50:opened`); substrate mantiene una mappa `pulse_dedup` (`key → container_id`). Un pulse la cui key è già vista *e* mappata è un **no-op** — restituisce il container esistente, non ne apre mai un secondo. Una key vista ma non ancora mappata (pulse in flight) coalesces invece di creare una race. Un pulse senza key è trattato come unico (l'emitter possiede il rischio di duplicato); gli external-event emitter (webhook) *devono* dichiarare una key. Questo è ciò che rende sicura l'autonomia dei node invece di una macchina auto-duplicante.

**Pulse come primitiva generale — incluso il lifecycle degli specialist.** Il daemon è esso stesso un emitter che osserva il runtime specialist ed emette lifecycle pulses: `specialist.spawned`, `specialist.compacted` (con un count), `specialist.stopped`, `specialist.context-threshold`. Qualsiasi partecipante può sottoscrivere. Questo significa che meccanismi come il respawn del coordinator (§5.9) non sono codice special-cased — sono *handler di un pulse*. Una primitiva, N usi: un webhook, uno script, una decisione del coordinator e una compaction specialist scorrono tutti attraverso la stessa superficie emit→react.

### 5.9 Context window del coordinator — kill e respawn

Un coordinator non può vivere per settimane compattando indefinitamente il suo context; la compaction degrada finché il modello perde il filo. **Regola pratica: al massimo due compaction, poi kill e respawn di un coordinator fresco.** Il daemon osserva il pulse `specialist.compacted`; al secondo, triggera il ciclo di respawn — il coordinator scrive il suo node-state finale, viene terminato, e viene spawnato un coordinator fresco.

Questo è sicuro solo perché **il coordinator è stateless rispetto al node** — lo stato del node vive nel container (substrate), non nella context window del coordinator. Questo è esattamente il motivo per cui §6.8 separa live (canali, effimero) da persisted (substrate, durevole): se il context del coordinator fosse l'unica copia, ucciderlo perderebbe tutto. Poiché lo stato è in substrate, il coordinator è un executor intercambiabile.

Un coordinator respawnato ricostruisce da **tre fonti**, in ordine:

1. **Lo scope del seed di origine — obbligatorio.** Risale `opened_by` fino al seed che ha avviato il node e rilegge il suo mandate/scope. Questo è "perché esisto, cosa devo fare." Senza di esso, un coordinator respawnato non conosce la propria missione.
2. **Messaggi recenti del canale — bounded.** Legge la tail recente del canale del node (ultimi N messaggi / ultima finestra) per apprendere le ultime azioni dei membri — cosa stava succedendo proprio ora. Non l'intera history.
3. **Il journal del coordinator — l'handoff.** Un artefatto mantenuto deliberatamente: decisioni chiave, watching-list, handled-set (con idempotency keys → child containers), open children. L'handoff che uno chef legge sul ticket dell'ordine quando prende in carico una postazione.

**Il journal porta uno state snapshot, non solo note — per gap detection.** A ogni checkpoint il journal registra `{ checkpoint_ms, channel_head_msg_id, open_children: [{id, state, owned_by}], handled_set, last_decision_ref, notes }`. Al respawn il nuovo coordinator confronta lo snapshot del journal con lo stato *live* che legge da substrate (channel head ora, children ora). La differenza è il **gap** — ciò che è successo tra l'ultimo checkpoint e la morte del vecchio coordinator. Un gap grande o contenente errori dice al nuovo coordinator che il journal non è completamente aggiornato, quindi ricostruisce con più cautela (rilegge di più, riverifica i children) invece di fidarsi ciecamente del journal.

**Cadenza dei checkpoint.** Il journal viene riscritto a checkpoint frequenti — dopo ogni pulse gestito, dopo ogni decisione di open/ownership-transfer — non solo al respawn pianificato. Un crash tra checkpoint perde solo l'ultima decisione, non l'intero turno. Stesso principio del channel reducer/after-hook (§7): persisti ai checkpoint, non all'uscita pulita.

Il **journal è distinto dalla memory** (§10): il journal è *stato operativo di questo node* (cosa è in flight ora) e muore con il node; la memory è *conoscenza durevole cross-task* e sopravvive al task. Il respawn legge entrambi, da luoghi diversi.

### 5.10 Failure recovery

Un container può terminare in modo non pulito. Il principio guida è **non distruggere mai lavoro su failure** — la distruzione di un worktree, un diff o findings accumulati è sempre una decisione deliberata (`abandoned`), mai un effetto collaterale di qualcosa che va storto. Questo riusa l'insight di §5.9 generalizzato a ogni container: lo stato che porta valore deve vivere nel container (persistito incrementalmente), quindi la morte di un processo effimero non è mai la morte del lavoro.

Non viene introdotta alcuna nuova entità. Il failure recovery è costruito interamente da pezzi che già esistono: i counter sono **state sul container**; il daemon **osserva** la terminazione dei processi ed emette **pulses** (i lifecycle pulses di §5.8); respawn, escalation e teardown sono **handler** di quei pulses (il meccanismo universale di §5.8). Non c'è alcun oggetto "watchdog" — il daemon osserva ciò che già possiede, il container contiene lo stato, gli handler reagiscono.

**Failure class.** Ogni terminazione non pulita porta `failure_class`:

- **`transient`** — crash, timeout, OOM, child process ucciso. *L'approccio era valido, l'esecuzione è inciampata.* Il daemon classifica questi meccanicamente da come il processo è morto.
- **`semantic`** — il seed non è riuscito a convergere, l'intento è ambiguo, o un container in esecuzione ha raggiunto una soglia di non-progress (sotto). *L'approccio stesso è difettoso.* Il daemon non giudica mai la semantica; rileva il *pattern* (conta il non-progress) e il *giudizio* resta al judge/reviewer che ha dichiarato il failure. Rilevamento meccanico, interpretazione semantica — la stessa separazione daemon-vs-coordinator di §5.8.

La classificazione resta **binaria**. Una terza situazione che sembra adiacente — una *precondition violation* (dispatch su una base stale, una dipendenza mancante) — deliberatamente **non** è una failure class: viene catturata al dispatch time dal precondition gate di §6.4 (*non avremmo dovuto iniziare*), senza mai entrare nel loop run-then-fail che questi counter osservano (*abbiamo iniziato e siamo inciampati*). Tenere le precondition fuori da §5.10 è ciò che mantiene i due counter a misurare solo genuine non-progress in-run.

**Il normale review loop non è un failure.** L'interazione executor/reviewer — e seconder, code-sanity, obligations — entro soglia è il ddiff loop (§3): operazione normale, interna a quei partecipanti, di solito si chiude in un PASS. Un semantic failure scatta solo a una **soglia di non-progress a qualsiasi gate**, contata da due counter che vivono come container state:

- **`semantic_after` (consecutivo, resetta su progress).** N cicli consecutivi senza progress a qualsiasi gate → escalate. Superare *qualsiasi* gate è progress reale e resetta il counter a zero, quindi una chain genuinamente difficile che avanza gate-by-gate (2 FAIL al reviewer, poi PASS, poi 1 FAIL alle obligations, poi PASS) sta funzionando, non è bloccata. Questo è il detector primario: cattura *il muro* — colpire ripetutamente lo stesso gate senza avanzare.
- **`hard_cap` (totale, generoso, non resetta mai).** N review iteration totali lungo la vita della chain, indipendentemente dal progress → escalate comunque. Questo è il backstop: cattura *l'attrition* — una chain che avanza-e-regredisce per sempre, resettando ogni volta il counter consecutivo ma senza mai chiudere. Senza questo, una chain potrebbe oscillare indefinitamente (passare un gate, fallirne un altro, regredire, ripassare) bruciando budget senza far scattare la soglia consecutiva. Generoso, quindi scatta solo sulla patologia reale, non su lavoro legittimamente laborioso.

**Escalation graduata (semantic).** Un semantic failure non va direttamente all'umano. Sale:

1. **Prima fermata — l'orchestrator.** Il container bloccato escalate all'orchestrator, che ha opzioni che il loop interno non ha: re-scope dell'issue, decomposizione della chain, aggiunta di un advisor mancante, riassegnazione. Tenta miglioramento *entro la sua policy* — autonomo, un livello di giudizio sopra l'interazione executor/reviewer.
2. **Seconda fermata — l'operator.** Solo se l'orchestrator determina che il problema supera la sua policy ("l'intero scope di questa chain era sbagliato fin dall'inizio") escalate all'operator e aspetta. Questo è il caso in cui nessuna ri-scoperta automatica aiuta e serve una decisione umana sul cosa-fare.

Stessa forma graduata della node autonomy policy (§5.8: entro policy agisci, oltre escalate). Un pattern di escalation unico nel sistema, non tre.

**Transient recovery.** Retry identico entro `max_retries`, poi escalate. Nessun giudizio necessario — l'approccio non era sbagliato, quindi ripeterlo è corretto. (Un seed raramente fallisce in questo modo; un executor crashato viene re-dispatchato ereditando il suo worktree + evidence e riprende da dove era arrivato.)

La **Recovery policy** vive sul container, parallela alla autonomy policy (§5.8), ereditabile da node/orchestrator:

```jsonc
"recovery_policy": {
  "transient": { "max_retries": 2, "backoff": "exponential", "then": "escalate" },
  "semantic":  {
    "semantic_after": 3,            // non-progress consecutivo a qualsiasi gate; resetta su progress
    "hard_cap":       12,           // review iteration totali, non resetta mai; backstop anti-oscillazione
    "auto_retry":     false,        // mai blind retry; il recovery deve cambiare approccio
    "escalate_to":    "orchestrator"  // primo rung; l'orchestrator escalate all'operator oltre la sua policy
  }
}
```

**Preservazione — cosa viene mantenuto, e per cosa.** Su qualsiasi failure il worktree e l'evidence non vengono mai distrutti; il container va a `closed:failed` (con la class) o resta `escalated` mentre il recovery è in flight — mai `abandoned` automaticamente. Il materiale preservato serve *scopi diversi* per class, nello stesso modo in cui un memory store serve tre query lens (§10):

- **Transient** → il materiale preservato serve per *resuming*: il diff mezzo fatto, i test già passati, i verdict parziali. Riprendi da dove eri.
- **Semantic** → il materiale preservato serve per *improving*: cosa è già stato provato e perché non ha funzionato, così il tentativo successivo cambia approccio invece di colpire di nuovo lo stesso muro. I findings di un seed sono dual-written (§5.5) e sopravvivono a `closed:failed`, quindi `sb seed rerun` li legge e il re-attempt costruisce su di essi — non è mai un replay. (Questo risolve la open-question #1: piani rejected/failed non sono una cache separata; il container failed semplicemente *non elimina la sua evidence*, lo stesso principio "survive the close" della memory promotion in §10.3.)

**Failure alimenta memory — il sistema impara da ciò che non ha funzionato.** Un semantic failure è una delle migliori fonti di memory che esistano, e il recovery rende esplicito il loop: prima che un container semantically-failed si chiuda, il **closing judge** — il chain coordinator per una chain (§4.3), il node coordinator per un node (§4.2), l'operator per un seed in escalation — estrae una memory **`type: failure`** ("scope mixed auth and logging; the executor couldn't satisfy both acceptance criteria"). È una memory ordinaria con metadata ordinari (`created_by_role`, `in_container`, `reason`, body), quindi è raggiungibile attraverso tutte e tre le lens (§10): un futuro executor in questo project tira "ecco gli approcci che falliscono qui" (identity), questo node sa "questa strategia non funziona" (workgroup), il project accumula anti-pattern noti (herd). Poiché il planner interroga la memory al seed time tramite la memory-query extension (§10.2), **un seed che pianifica lavoro simile a un failure passato tira automaticamente "questo è stato provato ed è fallito perché X"** — quindi il piano parte già evitando il muro. "Mind not to repeat" diventa strutturale, non speranzoso: il failure di oggi è il context pack di domani. I transient failure non producono memory — un inciampo tecnico non insegna nulla sull'*approccio*; solo i semantic failure portano una lezione, quindi solo essi vengono distillati.

**Teardown.** Quando un container raggiunge uno stato terminale (merged, closed, failed), il daemon emette il terminal pulse e gira un teardown handler: termina children ancora live, reap zombies, chiude il channel, prende il checkpoint finale. Su `closed:failed` il teardown esplicitamente **preserva** il worktree e l'evidence invece di reapparli — preservazione attiva, non sperata. (Un daemon-level / infrastructure failure — la morte del processo substrate stesso — è una categoria diversa, gestita al runtime/infrastructure layer; fuori scope qui.)
## 6. Il nuovo sistema di issue

La nuova issue è un contract strutturato, non prosa. Sostituisce la descrizione free-text di bd con campi nominati e stato validato dalla macchina.

### 6.1 Schema

```jsonc
{
  "id":               "iss-7f3a-001",
  "title":            "string (<= 120 chars)",
  "class":            "root|step|gate|advisor|followup",  // funzione strutturale nel grafo di lavoro (§6.10)
  "type":             "task|bug|chore|spike|design|research",  // SOLO su class:root — tipo di lavoro root
  "role":             "executor|reviewer|code-sanity|<custom>",  // chi esegue (era specialist_hint);
                                                                 // SOLO su classi non-root; può essere uno specialist custom dell'utente
  "priority":         0,                    // 0=critico, 4=backlog

  "contract": {
    "problem":      "string",               // obbligatorio
    "scope":        ["glob", "..."],        // obbligatorio; lista di glob, non prosa
    "non_goals":    ["string", "..."],
    "validation":   ["command", "..."],     // obbligatorio; eseguibile
    "acceptance":   ["observable", "..."],  // obbligatorio; osservabile esternamente
    "scrutiny":     "low|medium|high|critical",  // dial generico di profondità di review (vedi 6.6)
    "constraints":  ["string", "..."],
    "context":      [
      { "kind": "previous_chain", "ref": "chain:X" },
      { "kind": "memory", "ref": "mem-key" },
      { "kind": "decision", "ref": "iss-Y" }
    ]
  },

  "contract_state": {
    "status":           "invalid|partial|ready|waived",
    "stage1_run_at":    1731000000000,       // controllo programmatico dello schema (sempre)
    "stage2_run_at":    null,                 // giudizio agentico (solo se eseguito; §6.3)
    "blocking_gaps":    ["Acceptance not observable", "..."],
    "thin_flags":       ["'acceptance' may need more detail"],   // advisory, non bloccante
    "dispatch_allowed": true
  },

  "issue_local_rules": [
    "Do not touch source outside SCOPE.",
    "Preserve backward-compatible CLI flags."
  ],

  "chain_template":   "debug",              // opzionale; template nominato (§6.9); altrimenti risolto da type
  "memory_pack":      ["mem-key", "..."],

  // Le relazioni sono EDGES nella tabella issue_dependencies (§6.7), non memorizzate inline.
  // Questo blocco è una vista denormalizzata di comodo per la lettura che l'API può proiettare; gli edge sono canonici.
  "dependencies_view": {
    "blocks_on":       ["iss-X"],            // gate
    "parent":          "iss-EPIC",           // gate / membership
    "until":           [],                    // gate (temporaneo)
    "discovered_from": "iss-Y",              // context
    "validates":       [],                    // context
    "caused_by":       [],                    // context
    "relates":         ["iss-Z"],            // context (soft)
    "tracks":          [],                    // context (soft)
    "supersedes":      []                     // lifecycle
  },

  "work_state":       "draft|ready|claimed|running|waiting|reviewing|blocked|close_ready|done|archived",
  "review_state":     "unreviewed|partial|pass|fail",
  "close_state": {                          // calcolato/denormalizzato per le query (§6.10)
    "eligibility":      "blocked|close_ready|forced",
    "blocked_by":       ["string", "..."],  // popolato quando eligibility=blocked
    "close_ready_at_ms": 0,                  // prima volta in cui i predicati sono stati soddisfatti
    "closed_by":        "container-merge|cascaded-from:<id>|operator|--force|null"
  },

  "container_id":     "chain:7f3a",         // impostato quando il container si apre
  "primary_chain":    "chain:7f3a",         // per membri di epic/wave

  "evidence": [
    { "kind": "diff",     "ref": "feature/iss-7f3a-001-executor", "by": "exec_7f3a", "at_ms": 0 },
    { "kind": "verdict",  "ref": "msg#142",   "by": "rev_7f3a",   "at_ms": 0 },
    { "kind": "test",     "ref": "result#88", "by": "test_7f3a",  "at_ms": 0 },
    { "kind": "checklist","ref": "msg#142",   "by": "rev_7f3a",   "at_ms": 0 }  // checklist di release (6.6)
  ],

  "created_at_ms":  0,
  "updated_at_ms":  0,
  "closed_at_ms":   0,
  "close_reason":   "merged|merged-as-part-of-epic|step-complete|gate-passed|advisory-complete|decided|done|failed-transient|failed-semantic|failed-with-container|abandoned|abandoned-with-container|superseded"  // §6.10; mappa deterministicamente a done|archived
}
```
### 6.2 Stati del contratto (ortogonali allo stato del lavoro)

Due assi di stato, intenzionalmente indipendenti.

**Stato del lavoro** = dove si trova il lavoro.
**Stato del contratto** = se l'issue è un target di dispatch valido.

Un issue `claimed` + `invalid` è esattamente la modalità di errore che la dashboard evidenzia in rosso.

#### 6.2.1 Tre classificatori: class, type, role

Un issue porta tre classificatori che rispondono a domande diverse e non si sovrappongono. Tenerli separati è ciò che rende il sistema sia estensibile a specialisti custom sia strutturalmente resistente alla pigrizia dell'orchestrator.

- **`class` — la funzione strutturale nel grafo di lavoro.** `root | step | gate | advisor | followup`. Questa è *la posizione*: quale ruolo svolge questo issue nel flusso del lavoro, indipendentemente da chi lo esegue. È **memorizzata, non derivata** — e questo è il punto. Un utente può registrare uno specialista personale che il sistema non ha mai visto (un `quant-researcher` custom); il sistema non può derivare la funzione di quello specialista, ma la `class` gli dice come trattare lo step nel grafo a prescindere — un output `class: advisor` entra nel context pack e non blocca; un verdetto `class: gate` blocca; un `class: followup` non blocca mai. La class è il *contratto strutturale verso il grafo*; il sistema lo onora senza sapere nulla del role che lo riempie.
- **`role` — chi esegue.** `executor | reviewer | code-sanity | <custom> | …` (questo era `specialist_hint`, ora first-class). Indipendente da class — può essere uno specialista personale dell'utente di cui il core non ha mai sentito parlare. Presente solo su classi non-root.
- **`type` — il tipo di lavoro root.** `task | bug | chore | spike | design | research`. **Solo su `class: root`** — sotto-classifica gli issue root per tipo di lavoro (un root `bug`, un root `design`). Step/gate/advisor/followup non hanno `type`; hanno un `role`.

**class e role sono assi indipendenti — nessuno deriva dall'altro.** `class → role` fallisce (un `gate` non dice *quale* gate); `role → class` fallisce (un role custom non porta nessuna class che il sistema conosca). E lo *stesso* role può avere *classi* diverse in base alla posizione: un `researcher` è normalmente un `advisor` (produce contesto, non blocca), ma l'orchestrator può inserirlo come `gate` in una chain specifica (il suo verdetto blocca il reviewer finché non conferma — il caso `7egg`). Un `security-auditor` gira come `advisor` pre-executor (raccomandazioni) e come `gate` post-executor (verdetto bloccante) — stesso role, due classi (§6.9.3).

**Questa è la difesa strutturale contro la pigrizia.** La pigrizia dell'orchestrator è saltare gli step che bloccano. Se "blocking" fosse una proprietà del role, rendere qualcosa obbligatorio richiederebbe cambiare il role — rigido. Poiché `class` è un asse separato, memorizzato e applicato dal sistema, l'essere gate è *strutturale*: il sistema rende gli step `class: gate` non saltabili sui diff di produzione (§6.9.3) indipendentemente da quale role li riempia, e l'orchestrator non ha una leva per saltarli silenziosamente. La funzione-nel-grafo è dichiarata e applicata dal sistema, non lasciata all'identità negoziabile dell'esecutore.

**`root` è speciale.** Un root porta il *contratto di cambiamento* (le cinque sezioni, §6.1) — è il cambiamento desiderato, non qualcosa che viene eseguito. Quindi **non ha `role`** (nessuno esegue un root; è il lavoro), e **non è direttamente dispatchable**: per essere realizzato deve essere composto in una chain che generi almeno uno step. Un root può esistere prima della composizione (appena creato), ma `sb chain approve` è impossibile con zero step — nessuno step, nessuna forma da approvare, non gira (§6.9.5). Ogni root finisce con ≥1 step al momento del dispatch; anche il lavoro più semplice è `root → executor-step` (due issue, il root porta il *perché*, lo step porta il *come*), mai un singolo issue ibrido.

**`decision` è un outcome, non un classificatore.** Il lavoro deliberativo è `class: root, type: design` (o `research`); il suo *close outcome* è una decisione documentata invece di un diff `merged`. "decision" vive solo come `close_reason` (§22-class outcomes), mai come `class` o `type` — per questo è stato rimosso dall'enum `type` (dove le bozze precedenti lo avevano, collidendo con il suo significato di outcome).

La visibilità predefinita segue `class`: `sb issue ls` mostra `root`/`followup` (il lavoro a cui pensa l'operatore); `step`/`gate`/`advisor` sono interni alla chain, nascosti per default e mostrati nelle viste container (`sb container ps <id> --tree`).

### 6.3 Validator — due stadi

Eseguire un modello su *ogni* create/update di issue sarebbe eccessivo: costa denaro e aggiunge latenza a un hot path. Quindi la validazione è a due stadi, e solo il primo è universale.

**Stage 1 — programmatic (sempre, istantaneo, gratuito).** Un validatore di schema gira su ogni create/update. È puro codice, nessun modello. Fa due cose:

- **Hard-reject degli issue strutturalmente incompleti** — campi richiesti mancanti (`problem`, `scope`, `validation`, `acceptance`), tipi malformati, stati contraddittori. Questo è un gate non negoziabile; un issue che lo fallisce è `contract_state.status = invalid` e non può essere dispatchato.
- **Soft-flag degli issue sottili** — per i campi presenti, misura il contenuto rispetto a minimi configurabili (es. soglie di caratteri per campo) ed emette un hint, non un blocco: `thin: 'acceptance' may need more detail`. È advisory; non ferma il dispatch.

Quindi `sb issue create` restituisce un verdetto immediato di readiness — `ready` / `incomplete: missing X` / `thin: field Y may need more detail` — con zero costo di modello. Questo è il gate predefinito su ogni issue e su `sb dispatch`.

**Stage 2 — agentic (opt-in, o dentro un seed).** Un piccolo modello free-tier giudica la *qualità* che lo schema non può cogliere: il criterio di acceptance è davvero osservabile, lo scope mescola superfici non correlate, il problem statement è coerente. Questo **non** gira su ogni issue. Gira quando richiesto esplicitamente (`sb validate --explain <id>`), o come seed advisor dove la deliberazione è già il punto (§5). Produce il blocco più ricco:

```jsonc
{
  "status": "invalid",
  "dispatch_allowed": false,
  "blocking_gaps": [
    "Acceptance criteria are not observable from outside the process",
    "Validation command missing",
    "Scope mixes two unrelated runtime surfaces"
  ],
  "suggested_rewrite": {
    "problem":    "...",
    "scope":      ["..."],
    "non_goals":  ["..."],
    "validation": ["..."]
  },
  "recommended_template": "debug",         // nomina un chain_template (§6.9), non una sequenza ad hoc
  "recommended_chain": ["explorer", "executor", "test-writer", "reviewer"]  // gli step risolti, per la visualizzazione
}
```

Entrambi gli stadi scrivono la stessa forma `contract_state`, quindi i consumer non devono sapere quale l'ha prodotta. La separazione mantiene il percorso comune istantaneo e gratuito riservando il giudizio del modello a quando ne vale il costo. Stage 1 è il pavimento strutturale attraverso cui passa tutto; Stage 2 è il controllo di profondità a cui ricorrere.

### 6.4 Da dove vengono gli issue, e il dispatch gate

Un issue può nascere in **tre modi**, tutti first-class. bd ne aveva di fatto uno (creare un bead, `bd dep add` per collegarlo, `sp run --bead X` — tre atti manuali che l'orchestrator cablava a mano). Substrate nomina tre percorsi di nascita distinti e nessuno è privilegiato rispetto agli altri:

1. **Dall'approvazione del piano di un seed** — il percorso di planning.
2. **Inline dalla CLI dentro un container esistente** — il percorso diretto (operatore o orchestrator).
3. **Materializzato mid-flight da una `proposal`/`escalation`** — il percorso di discovery.

**Path 1 — approvazione del piano (il percorso di planning).** Un seed produce un `issue_set` di N issue proposti con le loro relazioni già dichiarate; all'approvazione substrate li committa tutti in una transazione — ID reali, dependency edge, container aperto, ciascuno timbrato con `container_id`, `memory_pack`, `issue_local_rules` (§5.7). Le relazioni epic→child esistono *prima di qualsiasi dispatch* perché fanno parte del piano. Questo è il percorso per lavoro net-new che richiede deliberazione. **Non** è l'unico percorso — è quello per quando non conosci ancora la forma del lavoro.

**Path 2 — creazione inline dentro un container esistente (il percorso diretto).** Quando il lavoro è già compreso — l'orchestrator o un umano sa esattamente quale sia l'issue — non c'è motivo di passare da un seed. Crealo direttamente in un container formato, con il contratto completo inline, e opzionalmente dispatchalo nello stesso respiro:

```bash
sb issue create --in-container <id> \
  --title "..." --type task \
  --problem "..." --scope "src/**" --validation "npm test" --acceptance "..." \
  [--rel discovered-from:<id>] [--rel blocks:<id>] \
  [--dispatch]
# → Stage-1 validator gira immediatamente (programmatic, gratuito); restituisce readiness
# → imposta container_id, scrive parent-child verso la testa del container + eventuali edge --rel
# → se --dispatch e Stage-1 passa: apre la chain per esso dentro il container
```

Ogni campo del contratto è una flag; le relazioni sono `--rel <type>:<target>` e possono ripetersi. `--in-container` implica l'edge parent-child (mettere un issue in un container *è* quella relazione — nessun `bd dep add` separato). `--dispatch` fonde create-and-run per il caso comune in cui l'operatore sa che il lavoro è pronto. Questo percorso è il modo in cui l'orchestrator inserisce lavoro in un container che ha già aperto, e il modo in cui un umano aggiunge un task noto senza cerimonie.

**Path 3 — discovery mid-flight (il percorso di discovery).** Uno specialista che trova nuovo lavoro *mentre sta girando* **non** crea l'issue da sé — emette una `proposal` o `escalation` nel channel del suo container. Substrate (o l'orchestrator) lo materializza:

```bash
sb issue create --in-container epic:9xg2 --intent "..." --rel discovered-from:<source-id>
# → crea iss-..., imposta container_id, scrive parent-child verso la testa dell'epic,
#   E l'edge discovered-from verso l'issue che lo ha fatto emergere — un solo atto, Stage-1 gira
```

Gli issue mid-flight dovrebbero portare una relazione che registri *perché sono apparsi* — oltre all'implicito parent-child, un `discovered-from` o `caused-by` verso l'issue/lavoro che li ha fatti emergere — così il grafo resta tracciabile invece di accumulare orfani senza contesto. (La forza di quel requisito — advisory vs. enforced — è una domanda aperta, §14.)

**Il dispatch gate.** Il dispatch si applica a un **root** (uno step-issue non viene mai dispatchato da solo — viene materializzato in una chain dalla composizione, §6.9.5). Qualunque percorso abbia creato il root, il dispatch è lo stesso gate, e dispatchare *compone la chain del root*: l'issue conosce già il suo container e le relazioni, quindi il dispatch non porta né container né parent.

```bash
sb dispatch <root-id>
# → Stage-1 validator gira, restituisce dispatch_allowed
# → se false: rifiuta, stampa cosa manca (e suggested_rewrite se Stage 2 è stato eseguito)
# → se true: risolve un chain_template (type-default, --chain-template, o auto-match),
#            materializza gli step-issue in una chain in `open` (la composizione, §6.9.5),
#            poi il composition gate: `sb chain approve` (automatico sotto policy) → `working`
#            (una chain già parte di un seed plan approvato è composta al momento dell'approvazione)

sb dispatch <root-id> --allow-unready --reason "emergency hotfix; manual validation only"
# → permesso con override persistito; review confidence marcata ridotta
sb dispatch <root-id> --chain-template <name> [--strict]   # override del template type-default
```

`sb dispatch <root-id>` non prende **nessun container e nessun parent** — il root porta entrambi. Gli step della chain non vengono hand-dispatched; substrate li fa avanzare guidato dal template (§6.9.1). Sotto approvazione `auto` (§5.6) la prima wave di un seed si compone e dispatcha da sola, quindi potresti non digitare nulla. Un root appena creato in-container (Path 2 o 3) entra in `work_state=draft` e passa lo stesso Stage-1 gate prima di poter dispatchare — nessun percorso bypassa il pavimento strutturale. Le modifiche di forma ad hoc avvengono durante la composizione: `sb chain insert` prima di `sb chain approve` (il percorso comune), o una forma completamente inline on-the-run passata al dispatch (§6.9.4) — mai tramite `sb issue create --class step`, che non è il modo in cui nascono gli step.

**Le precondition sono un gate al momento del dispatch, distinto dal failure recovery.** Stage-1 valida il *contratto*; un controllo parallelo valida il *runtime environment* prima del dispatch — es. la git-state precondition (la chain sta per forkare da una base stale perché una sibling chain non è stata mergiata?), o un futuro controllo "dependency-not-merged". Una violazione di precondition **non** è una classe di failure (§5.10): è *non avremmo dovuto iniziare*, intercettato prima della run, non *abbiamo iniziato e siamo inciampati*, contato durante essa. Il gate passa oppure **rifiuta il dispatch** con un envelope strutturato (la forma channels.md §10.2) che nomina cosa blocca e la prossima azione sicura; non entra mai nel loop run-then-fail osservato dai contatori di §5.10. L'override è deliberato e tracciabile in audit — `sb dispatch --allow-unready --reason "..."` — mai un default silenzioso. Questo separa nettamente le due preoccupazioni: §6.4 impedisce partenze sbagliate, §5.10 recupera run sbagliate.
### 6.5 Regole obbligatorie locali all'issue

Ogni issue può portare `issue_local_rules` che **vengono aggiunte a ogni prompt di specialista** generato da essa. Queste scorrono insieme alle regole obbligatorie globali e alle regole di ruolo.

```
GLOBAL_MANDATORY_RULES (from project)
ROLE_MANDATORY_RULES (from specialist config)
ISSUE_LOCAL_RULES     (from this issue's `issue_local_rules`)
```

Questo significa che lo stesso specialista `executor` si comporta diversamente tra issue diverse — stesso ruolo, stesso modello, invarianti diverse — senza prompt engineering per singola esecuzione.

### 6.6 Scrutiny, obligations, ddiff, release checklist (ispirati a Iron, domain-neutral)

Questi quattro concetti vengono dal modello di review Iron di Jane Street. Sono incorporati **genericamente** — substrate resta domain-neutral, perché gli specialisti di un utente potrebbero fare review legale, ricerca di trading o editing di prosa, non solo codice. I meccanismi vivono in substrate; la policy *specifica del codice* (quali percorsi file aumentano lo scrutiny) vive nella config distribuita, mai nel core di substrate. Questa sezione definisce i *concetti* (cosa significano scrutiny/obligations/ddiff); il layer di mandatory-gate del §6.9 è *dove vengono applicati come step di catena non skippabili* (code-sanity, obligations-scanner, security-auditor) sui diff di produzione e sulle superfici sensibili.

**Scrutiny — un regolatore generico della profondità di review.** `contract.scrutiny: low|medium|high|critical` sostituisce il vecchio campo `risk` (un asse, un nome; due divergerebbero). Dice quanto duramente la review dovrebbe lavorare qui, in termini domain-neutral:

| Level | Meaning (generic) |
|---|---|
| `low` | Solo seconder. Controllo a campione; nessuna analisi del blast-radius. |
| `medium` | Default. Profondità di review standard. |
| `high` | Sign-off punto per punto; evidenza di impatto richiesta. |
| `critical` | High + seconda opinione indipendente (o premortem). |

Il reviewer legge `scrutiny` e scala il proprio comportamento. Se il campo è assente, il default è `medium` (backward compatible).

**L'auto-escalation è config distribuita, non substrate.** Un reviewer può alzare il floor di scrutiny in base a ciò che il diff tocca — ma la tabella superficie→floor (`auth/*` → high, `migrations/**` → high, `src/permissions/*` → critical, …) è **policy orientata al codice** che viene distribuita con un set di specialisti per il codice, in `config/scrutiny/surfaces.yaml`. Questo rispecchia il modo in cui le regole seed advisor-invite vivono in config (§5.2). Un set di specialisti per review legale distribuisce la propria tabella di superfici (`**/contracts/*` → high) o nessuna. Substrate conosce solo il regolatore generico; non hardcoda mai un pattern di path. Il livello dichiarato dall'autore è un floor, non un ceiling; la config può alzarlo.

**Obligations — un gate generico, cablato tramite tether.** Marker nel lavoro che devono essere risolti o esplicitamente accettati prima del merge (nel codice: `TODO/FIXME/HACK/XXX`; in altri domini, qualunque cosa definisca il set di specialisti). Due punti di integrazione:
- Un matcher tether (`obligations`, §8) scatta quando un marker viene introdotto fuori dallo scope accettato.
- Il reviewer tratta le obligations su superficie di produzione come PARTIAL a meno che i `non_goals` dell'issue le accettino esplicitamente come follow-up. Uno specialista/advisor economico dedicato `obligations-scanner` può fare una pre-scan e postare un `finding`. Ciò che conta come "marker" è config del set di specialisti, non core di substrate.

**Ddiff — già nel lifecycle.** Il loop di re-review PARTIAL (§3) si limita al delta dall'ultimo verdetto; le approvazioni precedenti vengono mantenute. Questo è il concetto ddiff di Iron; substrate lo ottiene rendendo il loop reviewing→running scoped al delta anziché a una nuova audit completa.

**Release checklist — output machine-readable del reviewer che alimenta evidence.** Ogni verdetto porta una checklist strutturata (review pass, obligations cleared, impact-analysis ran, scrutiny level applied, scrutiny auto-escalated). Atterra come voce `kind=checklist` nell'`evidence` dell'issue e informa `contract_state`. Oggi è evidence letta dall'orchestrator; un futuro `sb container merge` può parsarla e applicare hard-gate. I *campi* sono generici; un set di specialisti per codice può aggiungere righe specifiche del codice (security-auditor ran, gitnexus ran) tramite la propria config del reviewer.

### 6.7 Relazioni tra issue

Le issue si relazionano tra loro in nove modi distinti. bd collassa tutti questi in `bd dep add --type X` senza differenza comportamentale tra loro — un edge `blocks` e un edge `discovered-from` sono memorizzati e trattati in modo identico, e la conseguenza runtime vive solo nella testa dell'orchestrator. Substrate li separa **per effetto sul runtime**: alcune relazioni fanno *gate* (cambiano cosa può partire), alcune portano *context* (cambiano cosa sa un agente), alcune sono *lifecycle* (cambiano cosa esiste), e alcune sono *tracing* (registrano cosa è successo). Il validator e il seed leggono gli edge di gating per decidere la dispatchability; l'estensione memory-query del planner (§10.2) legge gli edge di contesto per costruire il memory pack; la dashboard li legge tutti per la vista grafo.

| Relationship | Class | Runtime effect |
|---|---|---|
| `blocks` | **gate** | B non può lasciare il suo `seed` finché A non è `merged`. La hard precondition. |
| `parent-child` | **gate / membership** | Il child vive dentro il parent (epic); il `merge_ready` del parent dipende da tutti i child. Implicato anche da `container_id` (§6.7.1). |
| `until` | **gate (temporary)** | Come `blocks`, ma si dissolve quando arriva un evento/condizione nominata anziché al merge. Una precondition con scadenza. |
| `discovered-from` | **context / provenance** | Nessun gate. Registra *perché* l'issue esiste; alimenta context-depth (§6.8). |
| `validates` | **context / topology** | Il verifier (reviewer/test/sanity/security) è un nodo nella catena dell'implementation, non un blocker separato. Registra il link di verification. |
| `caused-by` | **context / diagnostic** | Nessun gate. Collega un sintomo di failure alla sua root cause per tracing. |
| `supersedes` | **lifecycle** | Chiude la vecchia issue, reindirizza i riferimenti alla nuova. Si abbina a `sb issue supersede`. |
| `relates` | **context (soft)** | Nessun gate. Emerge nel context pack solo se giudicato rilevante. |
| `tracks` | **context (soft)** | Nessun gate. Osserva un'issue esterna/upstream; sovrapposizione soft. |

Il contratto comportamentale è esplicito: **solo `blocks`, `parent-child` e `until` fanno gate sul dispatch.** Tutto il resto viene letto per contesto o registrato per tracing, non blocca mai il dispatch. Questa è la cosa che bd lasciava implicita e che substrate rende una proprietà del `kind` della relazione stessa.

**Due edge futuri, deliberatamente non aggiunti ancora.** Una review pass ha proposto `informs` (l'output entra nel context pack di un target) e `spawned_by` (provenance runtime da un pulse / evento template). Entrambi sono *sussunti oggi* — `informs` da `relates`, `spawned_by` da `discovered_from` — quindi, secondo la disciplina di non creare varianti finché un uso non le distingue, restano incorporati. I percorsi di split sono registrati per il prossimo agente: promuovere `informs` fuori da `relates` quando le regole di context-pack dovranno distinguere il contesto che alimenta il pack dal contesto soft; separare `spawned_by` da `discovered_from` quando replay/audit dovranno distinguere la creazione umana dalla materializzazione runtime. Fino ad allora, nove relazioni, non undici.

#### 6.7.1 Membership vs. relationship

Due livelli che bd confluisce, tenuti separati qui:

- **Container membership** — `container_id` sull'issue. "Questa issue vive dentro `epic:9xg2`." Una *proprietà* dell'issue, non un edge. Risponde a "in quale container mi trovo."
- **Issue relationship** — una riga in `issue_dependencies` (`parent-child`, `blocks`, …). "iss-A è parent di iss-B." Un *edge* semantico tra due issue, indipendente dal container. Risponde a "qual è la mia parent issue."

Di solito coincidono (il child di un epic ha `container_id=epic:9xg2` *e* un edge `parent-child` verso la testa dell'epic), ma non sempre: un'issue può avere un parent semantico o un edge `tracks` verso un container *diverso* (es. un'issue upstream). Tenere membership come proprietà e relationship come edge è esattamente ciò che permette a un child di essere "child di qualsiasi issue", non solo della testa del proprio epic.

#### 6.7.2 CLI

```bash
sb issue rel add <issue> <other> --type blocks|until|discovered-from|validates|caused-by|relates|tracks
sb issue rel rm  <issue> <other> --type <t>
sb issue supersede <old> --with <new>        # writes supersedes + closes old + redirects refs
sb issue rel ls  <issue>                      # all edges, grouped by class (gate/context/lifecycle/tracing)
# parent-child is normally created implicitly by `sb issue create --in-container` (§6.4)
```

### 6.8 Context-depth: live (channels) vs. persisted (substrate)

Come passa il contesto tra specialisti — viene ereditato dai channels, funziona come fanno oggi le bd notes, o viene passato in qualche altro modo? La risposta è **due flussi distinti, deliberatamente separati**, e confonderli è ciò che rende awkward le bd notes.

**Live / reading → channels.** Mentre un job gira, legge il channel del proprio container: il verdetto precedente, uno steer, un finding, gli hint del tether. Questo è "cosa devo sapere *adesso*." Effimero, vive nel dominio channels di `state.db`, sparisce quando il channel si chiude. Channels è la *superficie di lettura per gli specialisti stessi* — un reviewer legge il verdetto precedente nel channel; un executor legge lo steer.

**Persisted / tracing → substrate.** Quando un job finisce, il suo risultato — diff ref, verdetto, release checklist — viene persistito come `evidence` sull'issue in substrate. Questo è il record durevole. Quando l'issue B (che `discovered-from` A, o ha `blocks` su A) entra nel proprio seed, il context pack viene costruito **leggendo l'evidence persistita di A da substrate**, non facendo re-scrape del channel di A.

Quindi context-depth non è una camminata ricorsiva su note in prosa (il modello bd). È strutturato: substrate conosce la relazione (B dipende da A), estrae l'evidence strutturata di A (diff, verdetto, checklist), e l'estensione memory-query del participant (§10.2) la giudica per rilevanza. La *classe* della relazione (§6.7) decide cosa viene estratto — gli edge `blocks`/`parent-child`/`discovered-from` alimentano il pack; `tracks`/`relates` solo se giudicati rilevanti.

**Il dual-write che rende questo sicuro.** Il risultato di uno specialista viene scritto nel channel (live, per i peer che leggono ora) *e* persistito in `issue.evidence` (durevole, per futuro contesto). Questo rispecchia come il tether già fa dual-write degli hint (§8) e come il plan artifact fa dual-write (§5.5, §13.5). Il principio: **channels è dove gli specialisti leggono il presente; substrate è dove il passato viene persistito per essere riletto come contesto.** Il tracing non dipende mai dalla sopravvivenza di un channel, perché la copia durevole è l'evidence dell'issue, non il messaggio del channel. La stessa evidence persistita è ciò che la failure recovery (§5.10) preserva su `closed:failed` — il dual-write non è solo il meccanismo di contesto, è il meccanismo di preservazione: il lavoro è recuperabile precisamente perché il suo valore era già stato persistito incrementalmente, senza vivere mai solo nel processo effimero.
### 6.9 Template di chain e composizione — la forma con cui una chain viene eseguita

Una chain è l'unità minima di lavoro specialistico — anche una chain con un solo membro è una chain. La sua *forma* (quali step, in quale ordine, con quali gate) è definita da un **chain_template**: una definizione nominata e riutilizzabile da cui viene istanziata una chain concreta. Questa sezione stabilisce, una volta per tutte, come una chain avanza, come i suoi step vengono a esistere come contratti durevoli, chi compone la sua forma, e come viene condiviso il suo worktree — le domande da cui dipende tutto ciò che segue.

Una nota sulla nomenclatura: le bozze precedenti chiamavano questo una "workflow." Quella parola è generica (evoca pipeline BPM/n8n) e non dice che cosa *sia* la cosa in questo sistema. L'unità qui è la **chain**; un `chain_template` è la sua forma riutilizzabile. "Workflow" non appare in questo design.

#### 6.9.1 Il modello di avanzamento — le chain avanzano per template, non per orchestrator

Il vecchio modello implicito: l'orchestrator invia un executor, aspetta, invia un reviewer, aspetta, decide che la chain è conclusa. L'avanzamento è la discrezione passo-passo dell'orchestrator. È esattamente qui che diventa pigro sotto pressione di contesto — salta il reviewer, dimentica il debugger su una debug chain, usa l'overthinker solo quando viene richiesto esplicitamente. Una disciplina che dipende dalla diligenza di un modello è una disciplina che si erode.

Quindi l'avanzamento è **guidato dal template risolto della chain, eseguito da substrate, osservato dall'orchestrator.** Quando una chain entra in `working`, il suo template viene risolto in un piano ordinato esplicito di step-issues (§6.9.2); il ciclo di vita della chain (§3) avanza attraverso di essi — il participant di uno step completa e persiste la propria evidence → substrate avvia lo step successivo → … → tutti gli step superati → `merge_ready`. L'orchestrator non avvia ogni step manualmente. **Compone la chain, approva la sua forma, e osserva**; interviene solo sulle eccezioni (steer, pause, override, escalation).

Questo è il ruolo dell'orchestrator disegnato correttamente — ed è il ruolo dell'orchestrator in generale: **l'estensione tecnica e il giudice della visione dell'operator.** L'operator porta il *cosa* e il *perché* (la visione, possibilmente non tecnica: "correggi l'arrotondamento del Treasury"); l'orchestrator è il giudizio tecnico che traduce quella visione nella corretta struttura di lavoro (il *come*: questo è lavoro quant, critical blast, richiede un methodologist prima dell'executor). Mantiene ogni potere di *intervenire* — inserire un membro, reindirizzare, mettere in pausa, fare override — e perde solo il *dovere di guidare ogni step di routine*. Non stiamo rimuovendo il suo giudizio; stiamo rimuovendo l'esecuzione meccanica del giudizio, che lo libera per giudicare di più, non di meno. Meno lanci seriali di job, più composizione. Questo **riduce** l'attrito invece di aggiungerlo.

#### 6.9.2 Step-issues — ogni dispatch è sostenuto da contratto

Una chain è fatta di **step-issues**: ogni gate, advisor, reviewer, o executor run dentro una chain è sostenuto da un contratto issue durevole. Questo recupera una proprietà di bd che le prime bozze di substrate avevano silenziosamente abbandonato — in bd, ogni run aveva una bead, un record ispezionabile di *cosa gli era stato chiesto di fare*. Una code-sanity run aveva la sua bead; un reviewer aveva la sua bead. Rendere solo la root issue un contratto e gli step mere "roles" perderebbe questo. Quindi: **ogni specialist dispatch è issue-backed**, con prompt/mandate, state, origin, ed evidence persistiti e ispezionabili.

Due tipi di issue, due tipi di contratto — non uno stampo unico forzato su entrambi:

- Una **root issue** porta un **change contract** — le cinque sezioni (§6.1): `problem`, `scope`, `non_goals`, `validation`, `acceptance`. Descrive *un cambiamento desiderato nel mondo*. Questo è il lavoro nel senso che interessa all'operator; è ciò che `sb issue ls` mostra.
- Una **step-issue** porta uno **step contract** — una forma diversa, adatta a ciò che uno step fa (cioè produrre un *judgment* o un *artifact*, non descrivere un cambiamento): `mandate` (cosa questo participant deve fare), `inputs` (evidence che legge — la diff dell'executor, un finding precedente), `outputs` (cosa produce — un verdict, findings che citano file:line), `scope` (su cosa opera, ereditabile dalla root), `non_goals`. Forzare le cinque sezioni del change-contract su un gate produce campi vuoti o tautologici ("il problema è fare la tua review"); lo step contract è onesto sul fatto che uno step sia un task-over-inputs-toward-outputs.

Entrambi sono durevoli e ispezionabili (la proprietà di bd); differiscono nella struttura perché descrivono cose diverse. `sb issue show` su una root renderizza il change contract; su uno step, lo step contract.

**La composizione del prompt è esplicita e stratificata — un participant riceve il proprio ruolo, non lo inferisce.** Allo specialist di una step-issue non viene consegnato un blob indifferenziato da decifrare. Riceve layer etichettati (estendendo §6.5):

```
GLOBAL RULES
ROLE RULES: <role>            ← "you are the executor; you implement; you do not review"
PARENT CONTRACT: <root-id>    ← the root's change contract: problem/scope/acceptance — the why
STEP CONTRACT: <step-id>      ← this step's mandate/inputs/outputs — the precise task
INPUT EVIDENCE: <refs>        ← what prior steps produced (diff, finding, verdict)
CHANNEL CONTEXT: <recent>     ← live coordination
```

L'executor non inferisce di essere l'executor (ROLE RULES lo dice), né indovina quale sia la root (PARENT CONTRACT è etichettato), né deduce il proprio compito ristretto (STEP CONTRACT). Lo step contract "ristretto" è sicuro proprio perché il parent contract porta il contesto circostante. Per un *role* noto le ROLE RULES esistono già nella sua definizione di participant (§2.2); per un role genuinamente una tantum, il `mandate` dello step contract deve essere più ricco, poiché non ci sono role-rules su cui appoggiarsi — role noto → contratto generato; nuovo role → mandate esplicito richiesto, altrimenti substrate rifiuta di materializzare lo step.

**Risolto come stato persistito.** Quando la forma di una chain viene risolta (le sue step-issues materializzate), quello *è* il piano esplicito in avanti. Tre cose seguono da un unico fatto — il futuro è scritto, non emergente:

- **Overview / preheat.** La dashboard mostra ciò che la chain *diventerà* prima che si dispieghi — le step-issues esistono, con stato reached/pending — perché sono registrate.
- **Completeness contract.** Il daemon sa quali step la chain *deve* superare. `merge_ready` non è una dichiarazione — è "ogni step-issue richiesta dalla chain risolta è `done`." E per un gate, `done` significa **satisfied, non semplicemente eseguito**: una `code-sanity` che restituisce FINDINGS o un reviewer che restituisce FAIL/PARTIAL ha *eseguito* ma non è `done` — la chain non avanza oltre. Un gate è non negoziabile in due sensi, entrambi applicati dal sistema: non può essere **saltato** (il mandatory layer non è rinunciabile, §6.9.3), e un gate eseguito-ma-unsatisfied **blocca** — la chain non può progredire finché il verdict del gate non soddisfa la sua condizione (findings risolti o esplicitamente accettati nei non_goals, §6.6), tornando in loop a `working` per remediation (il ddiff loop, §3) nel frattempo. Uno step mandatory mancante (qualcuno ha provato a raggiungere `merge_ready` saltando `code-sanity` su una production diff) è una non-completion strutturale che il daemon rileva confrontando reached-state con la forma risolta — la stessa daemon-observes machinery dei non-progress counters (§5.10). Skip non autorizzato = escalation, programmaticamente. E un gate unsatisfied che non si chiarisce mai attraverso i remediation cycles è esattamente ciò che incrementa quei non-progress counters: o il gate è satisfied (la chain avanza) o resta unsatisfied abbastanza a lungo da far scattare `semantic_after` ed escalation (§5.10) — mai avanzamento oltre un gate unsatisfied, mai loop infinito su uno che non si chiarisce.
- **Pre-allocation.** Conoscendo lo step successivo, substrate può riscaldarlo (model warm-up, prefetch del context pack del role successivo).

#### 6.9.3 La definizione del template a due layer

Un `chain_template` vive in `config/chains/` — default distribuiti con uno specialist set, più custom per-repo che mescolano default con gli specialist propri dell'utente. Ci sono **due layer**, e tenerli separati è ciò che impedisce a ogni template di ri-dichiarare i gate:

**Layer 1 — il template** definisce gli step *domain-specific* per un tipo di lavoro. I custom roles si annidano *dentro* i bookend di default (executor apre, reviewer chiude), non li sostituiscono:

```yaml
# config/chains/quantitative-validation.yaml
name: quantitative-validation
description: "Data/statistical work needing numerical rigor"
steps:                          # domain-specific roles, between the default bookends
  - quant-methodologist
  - statistician
applies_when:                   # optional auto-match, same matcher as seed invite rules (§5.2)
  type: [spike, task]
  scope_matches: ["**/analysis/**", "**/*.ipynb"]
  scrutiny_gte: high
defaults:                       # optional, overridable by the issue
  scrutiny: high
```

Quindi `quantitative-validation` si risolve in `executor → quant-methodologist → statistician → reviewer`, non nei soli domain roles.

**Layer 2 — mandatory gates** è un layer separato che si applica a *ogni* template per condizione di risk/surface, indipendentemente da quale template sia stato scelto. Non fanno parte di un singolo template; si sovrappongono a tutti. Questo è il gate set in stile Iron, distribuito come config:

```
production diff      → code-sanity + obligations-scanner ALWAYS (mandatory, non-skippable)
sensitive surface    → security-auditor ALWAYS (auth, secrets, input handling, lockfiles,
                       agent/MCP/config, token storage, migrations, permissions/hooks)
reviewer             → auto-escalates scrutiny by diff content (§6.6 surfaces table)
```

La forma della chain per una substantive production diff è quindi gli step domain del template *con il mandatory layer sovrapposto*:

```
executor → code-sanity → security-auditor (if surface) → obligations-scanner → reviewer → merge
```

- `code-sanity` (seconder gate) e `obligations-scanner` sono **mandatory on production diffs**. Il reviewer tratta il loro `OK` come una precondition per PASS e restituisce PARTIAL se mancano.
- **Skip consentito solo** per eccezioni codificate: test-only diffs (interamente sotto `test/`, `__tests__/`, `*.spec.*`, `*.test.*`, `*.fixture.*`) o new-file-only diffs (nessuna modifica a simboli esistenti). **Qualsiasi altro skip è un escalation event** — le piccole diff nascondono le peggiori regressioni.
- I gate girano READ_ONLY sul job dell'executor (non acquisiscono il worktree lease, §6.9.6), in ordine; su un debugger-restitch vengono rieseguiti dopo il restitch turn, prima del reviewer; il loro output JSON è consumato direttamente dal reviewer tramite il job feed ed è evidence citabile nei rebuttals del reviewer.

I due layer si compongono alla resolution: la chain risolta è *Layer-1 domain steps + Layer-2 mandatory gates applicabili al risk/surface di questa diff*. Un template author non ri-dichiara mai i gate; il gate layer si attacca per condizione, e il mandatory layer non viene mai waived (§6.9.5).
#### 6.9.4 Tre origini di un template, e il ciclo di promozione

Una chain ha sempre una forma definita — non esiste dispatch senza una forma (il template è un requisito strutturale). Ma la forma non deve necessariamente essere pre-costruita; può nascere in tre modi, un gradiente che impedisce al requisito di diventare un onere di pre-configurazione:

- **Pre-built (shipped o custom).** Un template nominato in `config/chains/` — i sei default shipped (§6.9.10) o quelli che l'utente ha formalizzato. Riferito esplicitamente: `sb dispatch <issue> --chain-template quantitative-validation`.
- **Resolved by issue-type (zero input).** Ogni issue type porta un template di default: `bug` → `debug` (con `debugger` non-skippable — questo corregge "debugger dimenticato in una chain di debug ovvia"), `task` → `code-standard`, un tipo deliberativo come `design` → un template deliberativo (§6.9.8). La maggior parte dei dispatch non nomina alcun template — viene inferito. Questo è configuration-zero per iniziare.
- **Defined on-the-run (ad-hoc, ephemeral).** Quando nessun template pre-built si adatta, l'orchestrator/operator costruisce la forma della chain per *questa istanza* — "questa chain è explorer → executor → security-auditor → reviewer." Un template ephemeral, esistente solo per questa chain.

Il ciclo è **ad-hoc → repeated → formalized → engineered**: una forma on-the-run che si dimostra utile e ricorre viene *promossa* — scritta in `config/chains/`, nominata, resa riutilizzabile — esattamente come una workgroup memory promuove a herd (§10.3): "sopravvive perché si è dimostrata utile." Una skill agent-guided assiste la cristallizzazione (prendendo una chain che ha funzionato e proponendola come template formalizzato). L'utente non configura tutto in anticipo; cristallizza, a posteriori, ciò che ha visto funzionare. Il mandatory gate layer (§6.9.3) si sovrappone anche a un template ad-hoc, quindi una forma on-the-run non può mai sfuggire ai mandatory gates.

#### 6.9.5 Composizione in due momenti, con informazioni crescenti

La composition — decidere la forma del lavoro — avviene a due granularità distinte, in due momenti, e lo stesso giudizio può essere raffinato una terza volta a metà run. Questi non sono ridondanti; sono lo *stesso tipo di decisione presa con informazioni crescenti.*

**Momento 1 — container composition (seed-time, grana grossa).** Il seed delibera e produce la *forma del container*: quanti root-issues, come si relazionano, e quindi il container kind — `epic` (root dipendenti), `wave` (root indipendenti), o `chain` (un singolo root). Questo è §5.7 ("decides the kind from topology, opens it"). Il giudizio: come la visione dell'operator si scompone in unità di lavoro e come si relazionano. Il ruolo del **planner advisor è esteso** qui per proporre anche la chain shape di ogni root — non solo "ecco i 10 root" ma "ecco i 10 root, e per ciascuno, il chain_template proposto + le extra classes che il suo scope sembra richiedere." Così il Momento 2 ha già una *prima bozza* a seed-time.

**Momento 2 — chain composition (pre-dispatch di ogni root, grana fine).** Quando un singolo root-issue sta per essere dispatchato, viene decisa la sua *internal chain*: quali step-issues. La proposta seed-time del planner è il punto di partenza, ma il giudizio dell'orchestrator al dispatch ha **più informazioni di quante ne avesse il planner** — sa cosa hanno già prodotto le sibling chains nel container, quali pattern sono emersi, quali collisioni sono affiorate. Quindi può raffinare: "il planner ha proposto executor+reviewer per questo root, ma la sister chain ha appena rivelato che quest'area è insidiosa — aggiungo un explorer."

**Momento 3 — mid-run insertion.** Quando emergono informazioni *durante* la chain, un member viene inserito nella live chain (§6.9.9). Informazioni: + ciò che sta emergendo in questa chain stessa.

Tre momenti, informazioni crescenti, un solo tipo di giudizio (quale forma deve avere il lavoro):

| Momento | Chi | Informazioni disponibili |
|---|---|---|
| seed-time | planner propone | vision + memory + static scope |
| dispatch-time | orchestrator giudica | + ciò che le sibling chains hanno già prodotto |
| run-time | orchestrator / operator / daemon | + ciò che sta emergendo in questa chain |

In tutti e tre il *giudizio* è del model (il giudizio di un model da trilioni di parametri è molto migliore di una congettura programmatica); il layer programmatico **solleva soltanto la domanda** così che non possa essere dimenticata. Tre livelli di nudge alimentano il Momento 2:

- **L1 — programmatic nudge (deterministico).** Esattamente come la tabella scrutiny→gate (§6.6) auto-aggiunge security-auditor su una superficie sensibile, una **composition-nudge table** segnala extra classes tramite condizione deterministica (riusando il matcher `applies_when`/`invite_when` — un solo matching language): scope tocca un'area senza explorer-evidence recente → nudge `explorer`; il problema cita una keyword di external-library → nudge `researcher`; scrutiny=critical → nudge `overthinker`. Il nudge *solleva la domanda*, non la decide — appare come "consider an explorer (reason: no explorer-evidence in scope)" e l'orchestrator deve accettarlo o rifiutarlo attivamente con una ragione registrata. L1 rende la domanda inevitabile; non diventa mai uno stamp automatico.
- **L2 — issue-type nudge.** Il `type` del root nudga il template di default (sopra). I tipi deliberativi (`design`, `research`) defaultano a template deliberativi.
- **L3 — orchestrator judgment.** Ciò che nessuna regola cattura ("questo sembra semplice ma so che questo codice è insidioso"). Puro giudizio del model, e giustamente dell'orchestrator — il valore che porta come giudice tecnico.

**Il composition gate — il giudizio è forzato dal lifecycle, come la seed approval.** Una chain composta sta in `open` — i suoi step-issues materializzati, la proposta del planner e qualsiasi L1 nudge irrisolto presenti, ma **non ancora dispatched**. Non può entrare in `working` senza una shape evaluation esplicita, l'analogo di `sb seed approve`:

```bash
sb chain review <chain-id>      # mostra la forma proposta: step-issues, ordine, gates sovrapposti,
                                #   classi proposte dal planner + L1 nudges irrisolti
sb chain insert <chain-id> --role explorer \
  --before <step-id>            # POSITION nel grafo (before/after uno step esistente)
  --because "sister chain revealed this area is treacherous"   # ragione, tracciata
                                # → materializza l'explorer step-issue
                                # → genera il suo step contract dal role template (known role)
                                # → ricalcola edges: ciò che seguiva <step-id> ora blocks_on anche explorer
                                # → la chain resta `open` finché approvata
sb chain approve <chain-id>     # "shape is correct" → open transita a working, dispatcha il primo step
```

`sb chain insert` prende una *posizione semantica* (`--before`/`--after` uno step), e substrate deriva da essa le dependency edges — non scrivi edges a mano (quella era la riga da 11 flag della review). Known role → contract generato dal suo template + chain context; new role → mandate esplicito richiesto. Una chain non può entrare in `working` senza passare `approve` — ma sotto policy `auto` (§5.6) `approve` può essere automatico, esattamente come la plan approval può essere `auto`: il gate esiste sempre, può essere attraversato automaticamente quando la policy lo consente, quindi nessuna frizione nel caso fluido e il gate è lì quando conta.

#### 6.9.6 La worktree lease — un active writer alla volta

Una chain ha un worktree (§13.3). Il diritto di *scriverlo* è una **lease** — un diritto di scrittura temporaneo che uno step acquisisce e rilascia, non possiede. (Lease, non "lock": la semantica è un diritto concesso per un tempo che ritorna, coerente con l'handoff executor→debugger, ed è il sibling lato scrittura del `owned_by` mutabile del container, §2.6.)

```text
worktree_lease (on the container):
  held_by:        <step-issue-id> | null    (which writer-step holds the right now)
  state:          leased | free
  acquired_at_ms: <when>
```

- Un **writer-step** (executor, debugger — step che producono un diff) **acquisisce** la lease quando viene dispatched *e* la lease è `free`, e la **rilascia** su `done`/`waiting` (la quiescenza pi di §3.1: `agent_end` → `waiting` → lease rilasciata).
- Gli **step read-only** (gates, advisors) **non toccano la lease** — leggono il worktree senza acquisirla, quindi possono coesistere (code-sanity e obligations-scanner girano insieme sullo stesso diff).
- Il **daemon impone la serializzazione** (§3.1, già consumer dell'observability-bus): non dispatcha un writer-step mentre la lease è `leased`; lo accoda finché è `free`.

Questo formalizza "un active writer alla volta": al massimo un `held_by` non-null. Un secondo writer è il caso normale, non un edge — il **debugger-restitch**: l'executor produce un diff e diventa quiescente (rilasciando la lease), un gate trova una regressione, il debugger acquisisce la lease ora libera e produce una patch. Più writer *nel tempo* su una chain, un writer *alla volta*. Il discriminante da §6.9.5 diventa concreto: writer *simultanei* → chain separate su worktree separati (una wave/epic, collision-watched); writer *sequenziali* → un worktree, lease passata di mano. "Writer-step vs read-only-step" è ora una proprietà definita: acquisisce la lease?

#### 6.9.7 Il modello git — due assi: container kind e chain shape

Due cose venivano confuse e devono essere mantenute come assi separati, perché confonderle fa perdere lavoro:

- **Container kind (Momento 1) — come si relazionano i root.** `epic` (dipendenti), `wave` (indipendenti), `chain` (singolo root). Questo è il livello "molti root".
- **Chain shape (Momento 2) — la forma di un singolo root.** I suoi step-issues. Questo è il livello "un root, molti step".

Sono granularità diverse decise in momenti diversi; un `epic` contiene root, una chain contiene step. Il display path (`tx92.2.5`) è comodità — la verità è membership esplicita sul container (`parent_id`, §2.6), mai string-parsing.

Il modello fork-base deriva dagli assi, e substrate possiede il fork-base (risolvendo il vecchio fallimento `xtrm-nr05` "merge on wrong base", §4.3):

```text
standalone chain:   fork from main         → wt/chain-<id>
epic:               fork from main         → branch epic/<id>  (shared integration base)
  └─ child chain:   fork from epic/<id>    → wt/epic-<id>/chain-<id>   (sees siblings already merged)
wave:               (no shared base required)
  └─ child chain:   fork from main         → wt/wave-<id>/chain-<id>   (parallel, collision-watched)
```

La distinzione essenziale tra epic e wave è proprio qui al layer git: un **epic ha una shared integration base** (`epic/<id>`, forked from main) e le sue child chains forkano da *quel branch*, così i root dipendenti **vedono il lavoro già mergiato l'uno dell'altro** mentre avanzano; l'epic mergea su main come unità quando tutti i children sono integrati. Una **wave non ha una shared base** — le sue child chains forkano indipendentemente da main, girano in parallelo, e la collision matrix (§9) controlla che i loro worktree non collidano. Epic = progressive shared base (i children si vedono tra loro); wave = independent bases (i children non si vedono, parallelo).

**I nomi dei worktree ereditano il livello superiore**, così puoi capire dove sei e da dove vieni: `wt/epic-tx92/chain-tx92.2`, branch `epic/tx92/chain-tx92.2`. Il nome è derivato *dalla* membership del container (rispecchia `parent_id`), non parsato *per* dedurre la struttura — la stessa disciplina di §7 (il nome non è la semantica). Questo rende il layout leggibile sia a un umano (`git worktree list`) sia al daemon (che polla i worktree per la collision matrix, §9.1, e ora può raggruppare per epic/wave).
#### 6.9.8 Tipi di issue deliberativi

Non tutte le root sono lavoro di implementazione. Un `type` come `design` o `research` produce non una diff ma una *decisione documentata* — il suo template predefinito è deliberativo, non centrato sull'implementazione: overthinker + explorer + (un executor che scrive un design doc, non codice), chiudendo con un outcome `decision` invece di `merged`. Il type orienta il template (L2, §6.9.5), il template orienta le classes. Quindi il gradiente type→template→classes dà default sensati prima che l'orchestrator aggiunga giudizio, e una root deliberativa non viene mai forzata dentro una chain di implementazione.

#### 6.9.9 Mutazione live — membri che entrano a metà run

La chain risolta è stato del container, e lo stato muta: la forma effettiva della chain è *la forma risolta come modificata lungo il percorso*. Un member che entra a metà run è un'azione — materializzare una step-issue nella chain live, e (se writer) metterla in coda per la worktree lease — raggiungibile da tre sorgenti, ogni mutazione un evento tracciato sul container (chi, quando, perché — tracciabile come provenance):

- **Operator, a mano.** "Qui serve un researcher." `sb chain insert <chain> --role researcher --because "..."` — la superficie leggera con default inferiti (class da role, edges dalla posizione).
- **Orchestrator, per giudizio.** Dopo una escalation naturale, "questa decisione richiede un researcher." Inietta entro la sua policy.
- **Daemon, programmaticamente.** Un verdict del reviewer corrisponde a una regola → un member entra automaticamente. Quello potente, deliberatamente vincolato per restare solidissimo:
  - **Solo regole deterministiche, codificate** (`verdict FAIL tagged needs-security → insert security-auditor`), esattamente come la tabella di auto-escalation SCRUTINY. Il giudizio aperto resta all'orchestrator o all'operator — il daemon non indovina mai.
  - **Dentro il guardrail di non-progress.** Un member inserito programmaticamente conta come uno step contro i contatori di §5.10; se la chain non progredisce nonostante le inserzioni, `semantic_after` scatta ed escala — l'inserimento automatico vive *dentro* il guardrail di failure-recovery, quindi non può fare loop.

Un'inserzione read-only (researcher, overthinker, un advisor che aggiunge valore fondamentale che il template standard non prevedeva) **non acquisisce la lease**, quindi entra liberamente senza disturbare il writer attivo; la sua evidence di output entra nel context pack dello step che ne aveva bisogno. Un'inserzione writer (un secondo debugger) **si mette in coda per la lease** (§6.9.6). Se una data inserzione ricorre, è candidata alla formalizzazione nel template (§6.9.4) — il ciclo ad-hoc→formalized. Il discriminante è uniforme: writer tocca la lease, read-only no.

#### 6.9.10 I sei template predefiniti distribuiti

Questi sono i `chain_template` predefiniti distribuiti con il set di specialists — le istanze concrete del meccanismo a due layer di §6.9.3. Sono stati **estratti da chain reali** nei runtime reports (mercury 2026-05-25, specialists 2026-05-26) dalla review specialists-runtime, non inventati — ed è ciò che li rende una base predefinita solida (la base è ciò che tutti ottengono quando non configurano nulla, §6.9.4, quindi deve riflettere ciò che ha funzionato davvero). Sono scritti **flat** — ciascuno elenca i propri step di dominio Layer-1 — invece che tramite template inheritance: `extends` è deliberatamente rinviato (la stessa disciplina "non aggiungere variants finché la ripetizione non fa male" dei futuri relationship edges, §6.7). I mandatory gates Layer-2 (§6.9.3) si sovrappongono a tutti; nessuno li ri-dichiara.

| Template | Quando si risolve (`applies_when`) | Step di dominio Layer-1 (gates in overlay) | Estratto da |
|---|---|---|---|
| `code-quick` | `scrutiny: low`, ≤1 file in scope | *(nessuno — solo bookends + gates)* | mercury 2026-05-25 wave 1 (`98vy`, fix di una riga) |
| `code-standard` | `type: [task, bug]`, `scrutiny_gte: medium` | *(nessuno — il mandatory layer fa il lavoro)* | specialists 2026-05-26 (la pipeline Iron review) |
| `code-with-advisors` | `scrutiny_gte: high` | `explorer`, `methodologist` (prepended) | mercury 2026-05-25 waves 2–3 (`7egg`, blast critico) |
| `debug` | `type: [bug]` | `debugger` (sostituisce l'executor bookend; **non-skippable**) | note di debug mercury orphan-worktree + il gotcha "debugger-restitch loop" |
| `quantitative-validation` | `scope_matches: **/analytics/**, **/*.ipynb`; `tags: quant` | `quant-methodologist` (**non-skippable**), `quant-researcher` (se `needs-external-evidence`) | mercury 2026-05-25 (`7egg` methodology-before-executor) |
| `security-deep` | `scrutiny_gte: critical`; sensitive surface globs | `security-auditor` come **advisor** pre-executor (raccomandazioni prima del codice) | substrate §6.6 + la tabella di auto-escalation SCRUTINY di specialists |

Due cose che questi rendono concrete:

- **La forma risolta è Layer-1 + Layer-2.** Per esempio `code-standard` su una diff di produzione si risolve in `executor → code-sanity → [security-auditor if surface] → obligations-scanner → reviewer` — il template non contribuisce step di dominio, il mandatory layer contribuisce i gates. `quantitative-validation` si risolve in `quant-methodologist → [quant-researcher?] → executor → code-sanity → obligations-scanner → reviewer`, corrispondendo alla chain `7egg` effettiva (methodology bloccata prima che l'executor implementasse).
- **Lo stesso role in due classes.** `security-deep` esegue `security-auditor` come `advisor` pre-executor (class:advisor — raccomandazioni, non-blocking) *e* il mandatory layer di §6.9.3 lo aggiunge di nuovo come `gate` post-executor (class:gate — verdict bloccante) sulla sensitive surface. Stesso role, due classes per posizione (§6.2.1) — la participant definition dichiara valide entrambe le posizioni (§2.2). Questo è il motivo per cui class e role sono assi indipendenti: il template/layer decide la class, il role esegue soltanto.

Il `non_skippable: true` di `debug` sullo step `debugger` è ciò che chiude strutturalmente la pigrizia "l'orchestrator dimentica il debugger su una chain di bug ovvia" (§6.9.1) — lo step non può essere silenziosamente eliminato, solo saltato tramite escalation loggata. Il `quant-methodologist` non-skippable di `quantitative-validation` fa lo stesso per "methodology deve precedere l'executor sul lavoro quant."

Questi sei sono una base iniziale, non un insieme chiuso — sono archetipi concettuali che illustrano il meccanismo. Il runtime distribuisce un catalogo più ampio, evidence-backed (attualmente tredici) come file `bd formula` — i sei archetipi più chain deliberative e di maintenance (planning, premortem, research-only, triage, doc-sync, memory-hygiene, release-prep, restitch) estratte da un corpus di transcript più ampio; quelle deliberative realizzano il percorso deliberative-type di §6.9.8, e il `security-deep` del catalogo realizza il punto same-role-two-classes sopra. Nuovi template arrivano tramite il ciclo di promotion (§6.9.4): una forma on-the-run che ricorre viene formalizzata in `config/chains/` (oggi, una `bd formula`). Ci si aspetta che il prossimo agent, scavando altri run transcripts, ne trovi altre degne di essere distribuite (§14.1).

### 6.10 Chiudere una issue — close è una derivazione, non un imperativo

bd tratta close come un'*azione* su una issue. I suoi tre shim procedurali — un hook memory-ack, un hook commit-gate, un hook Stop — esistono perché bd non ha un modello di *cosa rende valido un close*; impongono disciplina dall'esterno. Substrate ha il modello, quindi gli shim non vengono portati, vengono **eliminati** — la stessa mossa del watchdog eliminato (§5.10) e lo stesso pattern che l'audit specialists-runtime chiama "compensation for missing model." Una issue chiude quando tre condizioni valgono: la sua **evidence soddisfa** la sua acceptance (il change-contract di una root) o il suo step-contract (uno step/gate/advisor); il suo **container state** permette di terminare il role della issue; e viene registrato un **close_reason** da un enum chiuso.

#### 6.10.1 La gerarchia di close — `close_ready` → `ready` → merge

C'è un annidamento pulito tra issue state e container state:

- Una member issue raggiunge **`close_ready`** (work-state: "all evidence in, satisfied, awaiting container close") quando la sua evidence soddisfa — e per un gate, soddisfatto significa *cleared*, non semplicemente *run* (il completeness contract, §6.9.2). Un gate che ritorna FINDINGS/FAIL **non** è `close_ready`; blocca e viene rieseguito (il loop ddiff, §3).
- Il container raggiunge **`ready`** quando *tutte* le member issues sono `close_ready` **e** il completeness contract è soddisfatto (ogni step che la forma risolta richiede è `done`).
- **`sb container merge`** è l'evento di close: chiude transazionalmente la root (`merged`) e ogni member step-issue in un solo passaggio.

Quindi `close_ready` è l'analogo per-issue del `ready` del container, e il close per-member è una *conseguenza del merge*, non una cerimonia per-issue. **Nel caso comune nessuno digita `sb issue close`** — il reducer deriva `close_ready` man mano che arriva evidence, il merge chiude tutto. Questa è la chain verso cui `sp finalize` di specialists-runtime legge in avanti: il reviewer scrive PASS evidence → il reducer deriva close_ready → container ready → merge chiude tutti i members. `sp finalize` scompare, non viene migrato.

**I members chiudono transazionalmente al merge, non nel momento in cui sono individualmente soddisfatti.** Gli step di una chain raggiungono `close_ready` a metà run ma il loro terminale `closed`+close_reason avviene *tutto insieme* al merge. Questo mantiene il close di una chain come *un* evento e significa che una chain che fallisce più tardi non lascia mai step `closed:gate-passed` orfani. L'unica eccezione è `followup` (non-blocking, non parte del completeness contract) — chiude indipendentemente, in qualsiasi momento.

**Dove si inserisce il chain coordinator nel close.** La derivazione `close_ready` del reducer è meccanica (predicati booleani su evidence persistita). Tra il container che raggiunge `ready` e `sb container merge` effettivamente eseguito, il chain coordinator (§4.3, role 4) fa il suo passaggio close-time: conferma o respinge la derivazione (interpretando casi borderline che il reducer non può decidere, §4.3 role 2 portato al close); verifica che git sia pulito *davvero* oltre porcelain; distilla memory `type:failure` / `type:best_practice` dall'outcome della chain (§5.10, §10.2); e propone issues `class: followup` per findings fuori scope tramite `sb issue create --rel discovered-from:<root>` (§6.7) — **questi followups sono normali root issues**, disponibili a scalare in future chain proprie tramite il normale percorso di promotion (§5: un followup può poi seedare la propria chain se il suo scope lo giustifica). Solo dopo questo passaggio il coordinator rilascia la chain a `sb container merge`. Su una chain che fallisce-then-cascades (§6.10.3), la distillazione che il coordinator avrebbe fatto viene presa in carico dal meccanismo esistente di §5.10 (closing judge, generic); le proposte followup vengono saltate (failure cascade preserva evidence; followup mining è per close puliti).

#### 6.10.2 Due percorsi, tenuti distinti

- **Automatico (la norma).** Transazionale al container merge. Il reducer deriva `close_ready`; il merge chiude. Zero comandi per-issue.
- **Esplicito (raro).** `sb issue close <id>`, governato da una tabella di eligibility (class × container-kind × container-state → eligible? + allowed close_reason). Se bloccato, ritorna lo **stesso structured-refusal envelope** del precondition gate di §6.4 e di channels.md §10.2 — una forma di refusal unica in tutto il sistema, non un terzo formato:

```jsonc
{ "ok": false, "error_code": "close_blocked",
  "blocked_by": ["container chain:7f3a is 'working'; step issues close on chain completion",
                 "issue iss-7f3a-005 has no verdict evidence yet"],
  "next_safe_action": "wait_for_evidence | force_close | abandon_container" }
```

Eligibility, in breve: una `root` chiude `merged` (single chain) o `merged-as-part-of-epic` (epic member) quando il container è `ready`; uno `step` chiude `step-complete` quando la sua acceptance evidence è presente e nessuno step downstream necessita di output non finito; un `gate` chiude `gate-passed` quando la sua verdict evidence è *satisfied* (non esiste un routine close `gate-failed` — un gate non soddisfatto blocca per §6.9.2, oppure l'intera chain muore e il gate cascades, §6.10.3); un `advisor` chiude `advisory-complete` quando la sua output evidence è presente; un `followup` chiude in qualsiasi momento (`done`/`abandoned`/`superseded`). Una root deliberativa (`type: design/research`, §6.9.8) chiude `decided` — l'outcome documented-decision, l'unico posto in cui "decision" vive (§6.2.1). `--force --reason "..."` sovrascrive l'eligibility, loggando un evento escalation.

#### 6.10.3 Container-failed cascade

Quando un container raggiunge `closed:failed`/`abandoned` prima che tutti i members siano `done`: i members non-done si auto-chiudono con `failed-with-container`/`abandoned-with-container`, la loro **evidence preservata** (§5.10 — non distruggere mai lavoro su failure), e un container ri-seedato può creare issues che `supersedes` quelle vecchie (l'edge esistente, §6.7). La cascade **è essa stessa un pulse handler** (§5.8, il meccanismo universale), non nuovo codice: container terminal pulse → cascade handler → batched member close.

#### 6.10.4 I tre shim, eliminati per riuso

Ogni shim bd si dissolve in un meccanismo che substrate ha già — nessuna nuova machinery:

- **memory-ack** ("hai salvato la lezione?") → **già §5.10.** Prima che un container semantically-failed chiuda, il judge/reviewer distilla una memory `type:failure`; il close flow *triggera quel meccanismo esistente*, non aggiunge un nuovo pulse. I close di successo non hanno una lezione end-of-issue da ack (il curator ha tirato la memory rilevante al seed-time, §10.2). Lo shim svanisce perché il modello definisce *quando* la memory viene distillata.
- **commit-gate** ("hai committato prima di chiudere?") → una issue non può raggiungere `close_ready` finché la sua evidence `diff` non è presente (il dual-write di §6.8). **Il dual-write *è* il commit gate** — un check separato è inutile.
- **Stop hook** ("hai dimenticato di chiudere prima di uscire") → i claim appartengono ai *participants* (jobs), non alle sessions. La fine di una session lascia il participant in `waiting` (pi keep-alive, §3.1), non la issue in `claimed`. L'accoppiamento session/issue che rendeva necessario l'hook è sparito.
#### 6.10.5 `done` vs `archived`, e riapertura

`close_reason` si mappa deterministicamente a una classe di visibilità — l’operatore non sceglie, è la reason a scegliere:

```
merged · merged-as-part-of-epic · step-complete · gate-passed · advisory-complete · decided · done   → done      (shown by default)
failed-transient · failed-semantic · failed-with-container · abandoned · abandoned-with-container · superseded → archived  (hidden; --archived to see)
```

Solo `failed-semantic` produce memoria di lezione (§5.10); gli altri archivi sono silenziosi. Gli stati di lavoro `failed`/`done`/`archived` sono quindi *derivazioni* di `close_reason` — un’unica fonte di verità guida sia lo stato sia la visibilità (motivo per cui `failed` è stato rimosso dall’enum `work_state`: una issue non è "failed" come stato, è `archived` con una reason `failed-*`).

`sb issue reopen <id>` è consentito solo da `{abandoned, failed-*, superseded}`; rifiutato per `{merged, *-complete, decided, done}` — il lavoro già consegnato non viene riaperto, viene invece creato un `followup` (legando il rifiuto della riapertura alla classe followup, §6.2.1).

#### 6.10.6 Cosa preserva da bd

La proprietà preziosa di bd era che ogni issue chiusa portava con sé una registrazione durevole e interrogabile di *cosa era stato deciso e perché* (`bd notes` attraverso le sessioni). Substrate la mantiene, in modo più rigoroso: `close_reason` è validato da enum (nessuna deriva nella prosa); l’array `evidence` (§6.1) è il "quale prova ha chiuso questo" canonico — riferimenti a diff, riferimenti a verdict, risultati di test, la checklist di release — tutto strutturato e re-interrogabile; il canale contiene ancora la discussione verbosa, raggiungibile tramite riferimenti ai messaggi nell’evidence (§7). La sostituzione è da bd-notes-come-prosa → substrate-evidence-come-riferimenti-strutturati: "cosa è successo su questa issue?" restituisce evidence collegabile, non un dump testuale.


---

## 7. Canali (riepilogo)

Riferimento incrociato: design completo in `channels.md` (il successore rinominato e irrobustito del vecchio design conversations). Un **channel** è una primitiva unica — uno stream di messaggi append-only, sottoscrivibile, multi-party (modello mentale: un canale Slack; la conversazione bilaterale a coppia è il caso degenere N=2). Fatti rilevanti per Substrate:

- Ogni container ha almeno un channel: il **planning channel** di un seed, poi channel per-chain durante l’esecuzione. L’ID di un container *è* l’ID del workstream del suo channel (`chain:7f3a`), quindi i due non divergono mai.
- I channel vivono nel **channels domain** del singolo `state.db` (`channel_messages` / `channel_subscriptions`), posseduto dal package channels (§13.4). I messaggi sono traffico runtime, distinto dalle tabelle di work-tracking di substrate. I messaggi sono tipizzati: `turn | finding | verdict | proposal | steer | ack | escalation | hint | system.* | note | error`.
- Le subscription sono dichiarate nel `.specialist.json` di ciascuno specialista. I membri si svegliano sui messaggi corrispondenti senza round-trip dell’orchestrator.
- **Due identificatori per messaggio:** un `seq` locale al channel (autoincrement — ordinamento e cursore) **e** un hash `msg_id` globalmente unico (stile Slack/Discord). Il `seq` ha significato solo dentro il suo channel; il `msg_id` è l’handle globale stabile per riferire un messaggio dall’esterno — un altro channel, l’evidence di una issue, un journal del coordinator, provenance (§13.4).
- **Invariante single-scheduler:** dentro un node/container, le scritture channel indirizzate a un membro NON lo riprendono direttamente; il runner legge il messaggio, valida il mittente e posta *intent* nella supervisor inbox del container. Il supervisor è l’unico scheduler che converte intent in una ripresa. Questo collassa il rischio di doppio control-plane.
- **Split reducer / after-hook:** ogni tick deriva lo stato del channel tramite un reducer puro e replayable (nessun I/O), poi esegue side effect (riprese, scritture `system.*`) in un after-hook deduplicato con chiave `(channel_id, msg_id)`. Un crash tra "enqueue resume" e avanzamento del cursore rilegge da `last_seen_id` e non si attiva mai due volte.
- **Separazione read/ack (cursor-through-N):** `readSince` è pura osservazione e non sposta mai il cursore; `markSeen(processed)` avanza solo fino al messaggio più alto *processato con successo*. Un messaggio per cui l’enqueue fallisce non fa avanzare il cursore.
- **L’autorità del body-text è sempre rifiutata:** un messaggio il cui body rivendica un ruolo o un’identità elevati viene declassato a `kind=note` al momento della scrittura e non attiva wakeup. L’autorità è verificata solo dallo stato dei participant nel DB.
- **`error` è un kind di messaggio stream**, non solo una envelope API — i rifiuti vengono scritti nel channel così un replay è autocontenuto per il post-mortem.
- **Backstop `judge_timeout`:** se un judge rimane silenzioso per N tick, il runtime emette automaticamente `system.continue` così i membri non restano mai bloccati dietro un judge bloccante.
- **Tether dual-writes hints** nel channel come `kind=hint, author_kind=tether`, così `sp tail` li mostra nello stesso stream di verdict e steer.
- **Anche l’artefatto plan dual-writes** nel seed channel come `kind=system.done body={plan}` così l’intera history del channel è uno stream replayable (la copia canonica resta la row `plans` — §13.5).

### 7.1 Coesistenza container-channel — gli specialist si inseriscono naturalmente

L’obiettivo è spostare il wiring della comunicazione **fuori dalla testa dell’orchestrator e dentro il runtime**. Oggi l’orchestrator porta con sé la topologia di chi parla con chi: deve dire al runtime "metti job X e job Y nello stesso channel, sottoscrivi X ai verdict di Y." Con substrate che possiede i container, quello stato si sposta nel container.

**Aprire un container apre il suo channel.** Quando substrate apre `chain:7f3a`, apre il channel come parte dello stesso atto — stesso ID, nessun passaggio separato che l’orchestrator debba ricordare. Il channel è semplicemente lì, per tutta la vita del container.

**Uno specialist dispatchato si inserisce nel channel automaticamente — tramite la sua spec, allo spawn.** Questo richiede precisione, perché "subscribed per il suo `.specialist.json`" fa molto lavoro:

- Il blocco `channel` del `.specialist.json` è uno **static subscription template** — design-time, lo stesso per ogni istanza di quello specialist. Dichiara *a cosa questo ruolo reagisce e cosa emette* (es. executor `subscribes: ["steer:me","verdict:me","finding:scope-overlap","system.*"]`). È un template, non una subscription attiva.
- La **active subscription** è una row in `channel_subscriptions` (`channel_id`, `participant_key`, `last_seq_seen`, `paused`) che lega *questo job specifico* a *questo channel specifico* con un cursore. Runtime, per-job, effimera.
- Il wiring: quando substrate dispatcha uno specialist dentro un container, **l’atto di spawnare il job dentro il container legge lo static template dalla spec, lo risolve rispetto al container e scrive la row active-subscription.** Lo specialist non si sottoscrive da solo; l’orchestrator non lo sottoscrive. "Già sottoscritto" significa *nel momento in cui il job esiste, esiste anche la sua subscription*, perché spawn-into-container è l’atto che la crea.

Quindi lo specialist non "si unisce a un channel." Viene spawnato dentro un container; il container ha un channel; lo spawn fa il wiring risolvendo lo spec template. Static template (config) → risoluzione automatica (spawn-time) → stato live (nel container). L’orchestrator non tocca nessuno dei tre — la topologia di chi parla con chi è ora una proprietà emergente di "chi è dentro quale container, con quali template," non stato detenuto dall’orchestrator.

**La risoluzione dei filtri relazionali richiede una lettura cross-store.** I filtri self-addressed (`steer:me`, `verdict:me`) si risolvono banalmente rispetto al `participant_key` del job. Ma i filtri relazionali — `finding:scope-overlap` ("svegliami sui finding i cui file intersecano *il mio* scope"), `turn:peer` — richiedono lo scope del job, che proviene dal contratto della issue (`contract.scope`) della issue che questo job sta eseguendo. Quindi la risoluzione spawn-time fa una lettura cross-store: specialists chiede a substrate "qual è lo scope della issue di questo container?" per risolvere il filtro. Questo è il pattern opaque-ID join-in-the-reader del §13.1, dove il "reader" è il runtime spawn-time.

---

## 8. Tether (riepilogo, rinominato da shepherd)

Riferimento incrociato: design completo in `tether.md` (precedentemente `shepherd.md`).

- Always-on di default. Sidecar per-job. Hook stile PostToolUse sul runner.
- Layer 1 = matcher deterministici (gratis, eseguiti a ogni tool call): scope-drift, repeat-mistake, relevant-memory (FTS5), tool-pattern, gitnexus-impact, budget-threshold, forbidden-action, stale-claim, **collision-overlap** (si attiva quando gli hunk di diff di questo worktree si sovrappongono a quelli di un’altra chain attiva), **obligations** (si attiva quando un marker come `TODO/FIXME/HACK` viene introdotto su una surface di produzione fuori dai `non_goals` accettati — §6.6; il vocabolario dei marker è config specialist-set, non hardcoded).
- Layer 2 = piccolo modello free-tier (Groq → Nvidia NIM → local Ollama → skip), si attiva solo quando Layer 1 resta quieto per K eventi.
- Gli hint vengono prepended al prossimo prompt turn — forzati, non opt-in.
- Soppressione: dedupe per id, cooldown per-pattern, cap hint per-job, tier di severity (`info|warning|blocker`).
- Aggiunta rilevante per Substrate: tether **legge dall’artefatto plan** allo spawn del job. Se il plan diceva "preserve `runInstall` calling convention," questo diventa un hint forzato ancorato a qualunque edit vicino a `runInstall`.

---

## 9. Matrice delle collisioni

Facility cross-cutting agganciata ai container, popolata tramite polling di ogni worktree attivo.

### 9.1 Fonte dati

Per worktree, ogni 8–15 secondi:

```bash
git -C <worktree> diff main...HEAD           # committed since branch
git -C <worktree> diff                         # uncommitted on top
```

Concatena. Analizza gli header `+++` per i file, gli header `@@` per i range degli hunk, conta righe aggiunte/rimosse per hunk.
### 9.2 Riferimento incrociato

Per ogni file che compare in ≥2 worktree attivi:

1. **Collisione a livello di file** (ambra): stesso file, nessuna sovrapposizione di intervalli. Da tenere d'occhio, spesso sicura.
2. **Collisione a livello di intervallo** (rosso): stesso file, intervalli di righe sovrapposti. Genererà conflitto al merge.
3. **Collisione semantica** (rosso, con avvertenza): intervalli non sovrapposti, ma una catena modifica un simbolo che l'altra catena chiama (risolto tramite `gitnexus_impact` in cache). Git farebbe un merge pulito; il comportamento potrebbe rompersi.

### 9.3 Emersione

- **Nella dashboard principale:** matrice compatta (file × worktree, celle = marcatori di hunk).
- **Come suggerimenti tether:** invia `blocker:collision-overlap` alle catene responsabili immediatamente al rilevamento.
- **Nell'artefatto di piano:** `seed_risks` e `collision_strategy.clusters` vengono popolati da una matrice *predetta* al momento del seed, poi riconciliati con la matrice *live* una volta che le catene iniziano l'esecuzione.
- **Nella CLI:** `sb collisions list [--container <id>]`, `sb collisions show <file>` (vista per-file della sovrapposizione dei diff).

### 9.4 Comandi di risoluzione

```bash
sb container serialize <chain:a> <chain:b>
  # chain:b attende nel suo seed finché chain:a raggiunge merge_ready

sb container unify <chain:a> <chain:b> --new-issue <intent>
  # genera un nuovo seed che comprime entrambe le catene in un singolo issue/executor

sb container pause <chain:b>
  # mantiene keep-alive ma smette di dispatchare nuovi job

sb reconcile <chain:a> <chain:b>
  # dispatcha lo specialist reconciler per leggere entrambi i branch e produrre un piano di merge
```

---

## 10. Memoria

La memoria è **conoscenza durevole e cross-task** — distinta dal journal del coordinatore (stato operativo di un nodo, §5.9) e dai messaggi di canale (traffico live effimero, §7). Oggi questo è bd memories + FTS5: piatto, chiunque scrive, tutto finisce in un pool generico di progetto, la retention è "quando esegui il memory-processor." Substrate mantiene l'idea generica di scrittura e FTS5 ma aggiunge **metadata**, e da quei metadata emergono tre livelli di memoria — *come query, non come campo*.

### 10.1 Una memoria è fatti + metadata; i livelli sono query

Una voce di memoria registra fatti e il contesto in cui sono stati appresi. Non porta un campo "scope" — forzare chi scrive a classificare sarebbe una falsa scelta, perché la stessa memoria è simultaneamente tutti e tre i livelli visti attraverso query diverse.

```jsonc
{
  "id":              "mem-7f3a",
  "type":            "bug | hint | best_practice | failure",  // classifica per query più precise
  "created_by_role": "executor",        // chi, come ruolo
  "created_by_job":  "exec_7f3a",       // chi, come istanza
  "in_container":    "node:research",   // dove è stata appresa
  "project_id":      "proj-abc",        // quale progetto
  "reason":          "why this is worth remembering",
  "created_ms":      0,
  "body":            "FTS5-able text"
}
```

`type` è un classificatore ortogonale (non un livello — i livelli restano le tre query sotto). Affina il recupero: le memorie `type: failure` sono l'insieme "cosa non ha funzionato, non ripetere" distillato dai fallimenti semantici (§5.10); un seed che pianifica lavoro simile le recupera così il piano evita muri già noti.

I tre livelli sono *query del consumatore* su quei metadata:

| Livello | Query | Esempio |
|---|---|---|
| **herd** (totale del progetto) | `project_id = X` | problemi noti, fare/non fare, decisioni architetturali — tutta la conoscenza appresa del progetto |
| **workgroup** (es. nodo) | `in_container = node:Y` (o lungo la sua provenienza) | ciò che *questo* nodo ha appreso ("la fonte X è inaffidabile") |
| **identity** (tipo di specialist) | `created_by_role = R AND project_id = X` | ciò che gli executor hanno imparato per essere qui ("il reviewer di questo progetto preferisce lo stile X"); ciò che i reviewer hanno imparato ("pattern di errore comuni di questo executor") |

I livelli **si incrociano**: una memoria scritta da `exec_7f3a` dentro `node:research` in `proj-abc` appare in *tutte e tre* le query — è herd (nel progetto), workgroup (nel nodo) e identity (scritta da un executor). Non è classificata come una sola; è un fatto, tre lenti. Questo significa: chi scrive non può classificare male (ogni memoria è raggiungibile da ogni lente che la include), e nuovi livelli vengono aggiunti come nuove *query* (es. "cosa sa un executor sul lavorare con *questo specifico* reviewer") senza migrare alcun campo.

Il livello identity è quello potente: il decimo executor generato in un progetto eredita ciò che i nove precedenti hanno appreso su come lavorare bene *con lo specifico reviewer di questo progetto* — un'identità di ruolo accumulata, non una tabula rasa.

### 10.2 L'accesso alla memoria è una capability, non un ruolo

Le bozze precedenti avevano uno specialist `memory-curator` dedicato — invitato al seed-time, avviato ad-hoc come controllo tether, che faceva giudizi di rilevanza con un piccolo modello free-tier. Il ruolo viene eliminato: **la query di memoria è una capability che ogni partecipante porta con sé, non un tipo di partecipante.** Il disaccoppiamento corrisponde al principio di §10.1 secondo cui i livelli sono query — se i livelli sono query, anche *l'accesso* è modellato come query, e l'accesso appartiene a chiunque abbia la query da porre. Tre luoghi in cui questo cambia concretamente:

- **Al seed/plan-time, il planner interroga la memoria da sé.** Il pi-runtime porta già istruzioni leggere di memory-fetch; substrate lo formalizza come **memory query extension** obbligatoria che viene anteposta al prompt del planner (analoga all'iniezione `ISSUE_LOCAL_RULES` di §6.5 — strutturale, non opt-in). Il planner esegue le query a tre lenti (herd / workgroup / identity) come parte del proprio ragionamento, decide dall'interno cosa è rilevante, e il piano approvato timbra il `memory_pack` di ogni issue dai risultati trovati dal planner stesso. Un advisor in meno nel seed, nessun layer di traduzione tra forma dell'issue e rilevanza della memoria.
- **Al run-time, lo specialist interroga la memoria da sé.** Stessa extension, stesse query a tre lenti, emerse ad-hoc dal partecipante quando il proprio lavoro richiede "l'abbiamo già visto?" — non pre-recuperate da un curator che non sa ancora cosa incontrerà lo specialist. Un professionista senior cerca ciò che gli serve quando gli serve; il runtime modella questo, non una pre-masticazione.
- **Al close-time, il coordinatore di catena distilla nuova memoria** (§4.3). Questa è la metà produttiva che il curator eliminato gestiva implicitamente: scrivere memorie `type:failure` quando un fallimento semantico dichiara "questo approccio è stato provato e non ha funzionato, il muro è X" (§5.10), e memorie `type:best_practice` quando una catena si chiude pulitamente con qualcosa che vale la pena portare avanti. La distillazione è giudizio su ciò che è appena accaduto — il giudice al close-time è l'attore giusto; il coordinatore di catena ha appena osservato l'intera catena e ha la lettura più pulita di cosa valga la pena ricordare.

Il controllo di rilevanza Layer-2 del tether (§8) resta com'è — un matcher sidecar con un piccolo modello locale che si attiva sui job silenziosi. Quel meccanismo è indipendente da "il partecipante interroga la memoria da sé"; il tether osserva le tool call, non ragiona. Nessun cambiamento lì.

Risultato: il ruolo dedicato memory-curator scompare da entrambe le estremità — advisor del planner e controllo tether — sostituito da una capability iniettata via extension che ogni partecipante porta con sé, e da una distillazione al close-time da parte del coordinatore di catena. Più economico (nessun dispatch extra per seed) e strutturalmente più pulito (l'accesso alla memoria corrisponde allo storage della memoria — entrambi modellati come query, nessuno dei due legato a un ruolo).
### 10.3 La retention è per-query, non per-field

Anche il pruning diventa una query. "Prune a retired node's memory" = delete `WHERE in_container = node:Y AND <not promoted>`. **Promozione** workgroup→herd non è una riscrittura di field — è semplicemente *non eliminare* la row quando il node muore, lasciandola raggiungibile dalla query herd (che filtra solo per project). Quindi promotion = "sopravvivere al pruning del container," demotion mai necessaria. Cosa renda "una buona memory" degna di essere conservata, e la cadenza del pruning, restano come nella policy memory-processor di oggi — ma ora la policy può agire per-level tramite queste query invece che su un unico flat pool.

**Aperto (deferred):** policy esatta di pruning per-level; il predicate di promotion (cosa rende una workgroup memory degna di essere mantenuta project-wide); se identity è per-role-global o per-role-per-project; come la provenance della memory (una memory scritta sotto `node:Y` da `exec_7f3a`) interagisce con il retirement del node. Queste sono le prossime domande di memory-design, non ancora chiuse.

---

## 11. Superficie CLI

I comandi appartengono al binary che possiede i dati. **substrate (`sb`)** possiede seeds, containers, issues, dispatch, collisions, memory, validation. **specialists (`sp`)** possiede le superfici job/event/channel/tether. La console legge entrambi; l'orchestrator legge entrambi.

### 11.1 Lifecycle dei container — `sb`

```bash
sb seed start --intent "..."                # apre un seed container, esegue il planning channel
sb seed start --from-issue iss-X            # raffina/decompone un issue esistente
sb seed status <seed-id>                     # advisor state + budget + plan draft
sb seed approve <seed-id>                    # committa il plan; trasforma il seed in final container
sb seed reject <seed-id> --reason            # chiude il seed (abandoned)
sb seed rerun <seed-id> --redirect "be more specific about scope"

sb container ps                              # elenca i container attivi (seed/chain/epic/wave/node)
sb container ps <container-id>               # mostra dentro: issues, jobs, worktrees, channel
sb container ps --tree                       # vista nidificata (epic > chains)
sb container ps --all-projects               # solleva il project scope (shared store)

sb container serialize <a> <b>
sb container unify <a> <b> --new-issue "..."
sb container pause <id>
sb container resume <id>
sb container merge <id>
sb container abandon <id> --reason "..."
sb container chown <id> --to <owner>         # trasferisce ownership (orphan handling / escalation)

# nodes (standing containers)
sb node start --mandate "..." [--policy <file>]   # apre uno standing node + coordinator
sb node ps <node-id>                          # node state, children, queue, journal head
sb node pause <node-id> | sb node retire <node-id>

# emitters & pulses (il signal layer)
sb emitter register --kind script|service|external --def <file>
sb pulse emit --kind trigger|job|message --key "<idempotency-key>" --body <json>
sb pulse queue <node-id>                      # ispeziona la FIFO pulse queue di un node
```

### 11.2 Lifecycle degli issue — `sb`

```bash
# crea un ROOT (issue create ha default class=root; gli steps NON sono creati qui —
# nascono dalla chain composition / `sb chain insert`, §6.9.5) — tre forme (§6.4)
sb issue create --intent "..."               # bare draft root; Stage-1 schema-check viene eseguito (free)
sb issue create --in-container <id> \        # full contract inline in un container esistente
  --title "..." --type task \
  --problem "..." --scope "src/**" --validation "npm test" --acceptance "..." \
  [--rel discovered-from:<id>] [--rel blocks:<id>] [--chain-template <name>] [--strict] [--dispatch]
sb issue show <id>                           # full contract + state
sb issue update <id> --field <path> <value>  # update schema-validated; riesegue Stage-1
sb issue ls [--all-projects]                 # root/followup di default (§6.2.1)
sb issue ls --class step,gate,advisor        # mostra gli interni della chain

sb dispatch <issue-id>                       # gate; apre container se Stage-1 passa
sb dispatch <issue-id> --allow-unready --reason "..."
sb dispatch <issue-id> --chain-template <name> [--strict]  # override del template type-default (§6.9)

sb validate <issue-id>                       # Stage-1 (programmatic) su un issue
sb validate --explain <issue-id>             # Stage-2 (agentic): judgment + suggested_rewrite
sb validate --plan <plan-id>                 # esegue su un intero plan

# chain templates (§6.9)
sb chain-template ls                         # elenca i template definiti (shipped defaults + custom per-repo)
sb chain-template show <name>                # steps, applies_when, defaults
sb chain review <chain-id>                   # shape proposta: step-issues, order, overlaid gates, unresolved nudges
sb chain insert <chain-id> --role <r> --before|--after <step-id> --because "..."   # aggiunge uno step (§6.9.5)
sb chain approve <chain-id>                  # la shape è corretta → open transita a working, dispatches

# issue close (§6.10) — raramente necessario; container merge chiude i member transazionalmente
sb issue close <id> [--reason <r>] [--evidence <ref>]   # valuta eligibility; structured refusal se blocked
sb issue close <id> --force --reason "..."   # override di eligibility; registra escalation event
sb issue reopen <id>                         # solo da abandoned|failed-*|superseded; altrimenti crea un followup
sb issue ls --archived                       # mostra gli issue archived (hidden di default)

sb collisions list [--container <id>]
sb collisions show <file>

sb memory propose --container <id>           # invoca manualmente memory query/distillation
```
### 11.3 Osservabilità — `sp` (specialists) + `sb` (substrate)

```bash
# specialists — jobs, events, channels, tether
sp feed -f                                   # stream di job/lifecycle/channel/tether
sp feed -f --kind channel,tether
sp feed -f --workstream <conv:id>

sp tail <conv:id> [-f] [--kind verdict,finding] [--jq '.body.severity']
sp msg  <conv:id> "..."                      # un umano posta un'indicazione in un channel
sp ch open a b [--topology reactive] [--stop-on pass]   # channel ad hoc, nessuna config del node
sp ch list [--workstream <id>] [--status open]
sp ch show <conv:id>

sp tether hints <job-id>                     # tutti gli hints iniettati finora
sp tether hints <job-id> --pending           # blocker sticky attualmente presenti
sp tether stats <job-id>
sp tether clear <job-id> [--id <hint-id>]

# substrate — stream di container/issue/contract/collision/plan
sb feed -f                                   # stream di container/issue/contract/collision/plan
sb feed -f --container <id>
```

### 11.4 Il flusso unificato

Il singolo "unified event stream" della console (LIFE / CHAN / TETH / COLL / CTRC / PLAN) è la **fusione di `sp feed -f` e `sb feed -f`**, intercalata per timestamp. Nessuno dei due binari possiede tutte e sei le classi: LIFE / CHAN / TETH provengono da `sp`; COLL / CTRC / PLAN provengono da `sb`. La console (o `xt feed -f`, un sottile wrapper di convenienza nel core) multiplexa i due. Non esiste un singolo comando feed monolitico in un modulo — ogni modulo trasmette in stream ciò che possiede.

---

## 12. Dashboard

La dashboard è un renderer sullo stato runtime. Ogni pannello mappa a un comando CLI; nessuna conoscenza solo-UI.

### 12.1 Layout di primo livello

```
┌─────────────────────────────────────────────────────────────┐
│ Header: conteggio container · conteggio collision · conteggio conv aperte │
├──────────────────────────┬──────────────────────────────────┤
│ Issue attive             │ Matrice file-touch                │
│ (stato contract visibile)│ (cross-reference live git diff)   │
├──────────────────────────┼──────────────────────────────────┤
│ Unified event stream     │ Focus pane: job selezionato       │
│ (lifecycle + channel     │ - tether hints                    │
│  + tether + collision    │ - sottoscrizioni channel          │
│  + contract)             │ - budget/turn/token meter         │
│                          │ - percorso lineage                │
├──────────────────────────┴──────────────────────────────────┤
│ Superficie conversazionale per il container selezionato      │
│ (seed, chain conv, o epic-channel)                           │
└─────────────────────────────────────────────────────────────┘
```

### 12.2 Scheda container

Per ogni container attivo:

```
seed:7f3a · working · 47s trascorsi · budget 11/15 turns
├─ overthinker      · valuta la superficie di rischio
├─ researcher       · controlla le convenzioni publish.yml
├─ devops-spec      · ✓ ha postato finding (3 raccomandazioni)
├─ planner          · ✓ ha postato finding (2 memorie rilevanti recuperate via extension)
└─ seed-judge       · in attesa di overthinker

draft plan: 3 issue · stima $0.85 · stima 35min wall · 1 cluster (serial)
```

Una volta che il container avanza a `working`, la scheda cambia per mostrare la forma risolta della chain — step-issues con stato raggiunto/in sospeso, i gate obbligatori sovrapposti, e quale step detiene attualmente il worktree lease (§6.9.6):

```
chain:7f3a · working · executor detiene lease · scrutiny: high
├─ ✓ explorer         (advisor)  done
├─ ✓ quant-method.    (advisor)  done
├─ ▶ executor         (step)     running · detiene worktree lease
├─ ○ code-sanity      (gate)     pending
├─ ○ obligations      (gate)     pending
└─ ○ reviewer         (gate)     pending
```

Gli step in sospeso sono il preheat/overview (§6.9.2): il futuro della chain è visibile perché la forma risolta è registrata. Un gate mostra `blocked` (non `done`) se è stato eseguito ma ha restituito FINDINGS/FAIL.
### 12.3 Palette delle classi di eventi

| Classe | Colore | Fonte |
|---|---|---|
| `LIFE` | grigio | eventi del runner |
| `CHAN` | viola | messaggi di canale tra partecipanti |
| `TETH` | ambra | suggerimenti tether |
| `COLL` | rosa | eventi di rilevamento collisioni |
| `CTRC` | blu | eventi del validator |
| `PLAN` | verde | artefatti del seed plan |

### 12.4 Parità reader/orchestrator

La dashboard legge gli stream unificati `sp feed -f` + `sb feed -f`. L’orchestrator legge gli stessi due stream. Le differenze sono puramente di rendering (colore, raggruppamento, sparklines vs. testo). Qualsiasi cosa la dashboard possa mostrare, l’orchestrator può interrogarla.

---

## 13. Modello dati / storage

### 13.1 Un solo store, proprietà per dominio nel codice

C’è **un solo database**, un daemon, un socket: `~/.xtrm/state.db` (SQLite WAL). Il precedente design a due store (`~/.sb/state.db` + `~/.sp/observability.db`) viene abbandonato — poiché xtrm espone la propria API (§17) e la console/i nostri strumenti sono i suoi primi consumatori, l’API è la superficie di separazione, non i file. Un db, un processo è più semplice da usare e rimuove le modalità di fallimento da coordinamento tra daemon.

La separazione avviene per **proprietà di dominio nel codice**: ogni package possiede lo schema delle proprie tabelle ed è l’unico codice che le scrive. Le tabelle sono namespaced per dominio:

| Proprietario del dominio | Tabelle |
|---|---|
| **substrate** | `projects`, `containers`, `plans`, `issues`, `issue_dependencies`, `collision_events`, `validator_runs`, `pulse_dedup`, `pulse_queue`, `triggers`, `memories` |
| **channels** | `channel_messages`, `channel_subscriptions` |
| **specialists** | `jobs`, `runner_events`, `tether_hints`, `telemetry_samples` |
| **core** | marker `<repo>/.xt/` (worktree registry, hook config) — ancora su disco, non nel db |

Un utente che non usa parte del sistema ha semplicemente tabelle vuote — costo zero.

**La correlazione avviene tramite ID opaco, mai tramite foreign key — anche se è un solo db.** `chain:7f3a` di substrate è una stringa che gli altri domini trattano come identificatore; nessun dominio impone una FK oltre il confine. Specialists scrive `workstream_id='chain:7f3a'` sulle proprie righe job e si fida che substrate sappia cosa significhi; substrate scrive `iss-7f3a-001` e si fida che specialists tagghi i job con esso. La join ("tutti gli eventi sp per questo container") avviene nel *reader*, ora una banale query sullo stesso db. Mantenere la disciplina no-cross-domain-FK anche in un solo db è deliberato: è ciò che permette ai domini di essere separati di nuovo in seguito (sharding, o specialists su una macchina diversa) senza redesign. Separazione nel codice, semplicità di un solo store a runtime.

Questo mantiene specialists **agnostico rispetto al progetto**: il concetto di `project_id` vive interamente nel dominio di substrate.

### 13.2 Lo store: condiviso di default

`state.db` è **condiviso tra tutti i progetti su una macchina**, servito da un singolo daemon. Questo è deliberato, ed eredita una lezione dura dal drift di bd verso server Dolt per-progetto: quando ogni progetto (o worktree) avvia il proprio daemon, ottieni il fallimento "9 servers found, expected 1", corruzione del journal da scritture concorrenti, ed errori "database not found" di bd dentro i worktree. Un daemon, molti progetti, instradati da `project_id`, evita tutti e tre.

```
~/.xtrm/
├── state.db              # lo store canonico singolo (SQLite, modalità WAL)
├── state.db-wal
├── state.db-shm
├── daemon.sock           # socket Unix (named pipe su Windows)
├── daemon.pid
└── daemon.log

<repo>/.xt/
└── project.json          # { id: "proj-abc123", name: "xtrm", created_at_ms: ... }
```

Regole di design per il daemon, ciascuna indirizzata a una specifica modalità di fallimento di bd osservata in run reali:

- **Lazy launch con file lock.** Il primo comando `xt`/`sb`/`sp` avvia il daemon; un launch lock impedisce a due invocazioni simultanee di avviarne entrambe uno. (I "9 servers" di bd venivano dalla sua assenza.)
- **Pulizia del lock consapevole del PID.** Un lock stale il cui PID nominato è morto viene rilevato e pulito al successivo launch, non lasciato a bloccare per sempre.
- **Socket Unix, non porta TCP.** Nessun conflitto di porta; gestione permessi a livello OS; raggiungibile da qualsiasi worktree sulla macchina. (Risolve il "database not found" di bd nei worktree — friction bead `xtrm-hhiu`.)
- **SQLite + WAL, non Dolt.** WAL gestisce correttamente reader concorrenti e writer serializzati ed è molto più crash-resistant del journal Dolt che si è corrotto a metà sessione (`xtrm-yb0u`). Il "daemon" è un sottile service wrapper che possiede il file, mantiene prepared statements, esegue migrations e serve gli endpoint di streaming feed — non un DBMS completo.
- **Un solo owner, tutti i domini.** Il daemon gira come l’utente invocante e ospita tutte le tabelle dei domini (substrate, channels, specialists). Ogni package di dominio è l’unico codice che scrive le proprie tabelle; il daemon possiede solo il file e il socket.
- **L’identità del progetto è first-class.** `xt init` registra il repo con il daemon: scrive una riga `projects` e deposita `.xt/project.json` nel repo. Qualsiasi comando successivo risale dal cwd per trovare `project.json` (come git trova `.git/`) e applica lo scope implicitamente. `--all-projects` solleva lo scope.

### 13.3 Tabelle del dominio substrate

Ogni riga è scoped da `project_id`; il daemon aggiunge automaticamente il predicato a ogni query.

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,           -- proj-abc123
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,              -- percorso assoluto canonico su questa macchina
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE containers (
  id             TEXT PRIMARY KEY,          -- seed:X | chain:Y | epic:Z | wave:W | node:N
  project_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,             -- 'seed' | 'chain' | 'epic' | 'wave' | 'node'
  state          TEXT NOT NULL,             -- lifecycle astratto: open|working|converging|ready|closed|escalated
  -- tre assi (§2.6)
  parent_id      TEXT,                      -- MEMBERSHIP: in quale container vivo (nullable, mutable)
  opened_by      TEXT,                      -- PROVENANCE: chi mi ha aperto (immutable)
  opened_reason  TEXT,                      -- PROVENANCE: plan-approval|node-trigger|manual|escalation
  origin_chain   TEXT,                      -- PROVENANCE: chain to root memorizzata (es. "node:r/seed:y/chain:z")
  owned_by       TEXT,                      -- OWNERSHIP: attore responsabile in questo momento (mutable)
  -- solo node
  autonomy_json  TEXT,                      -- policy del coordinator: node = autonomy + can_open_containers (§5.8);
                                            --   chain = max_inserts, allowed_insertion_roles,
                                            --   max_followup_proposals, escalate_when (§4.3)
  chain_coordinator_model TEXT,             -- solo chain: modello su cui gira il chain coordinator, dichiarato da
                                            --   chain_template (§6.9.10); null significa nessun coordinator
  coordinator_journal_json TEXT,            -- solo node: stato di handoff del coordinator per respawn (§5.9):
                                            -- { checkpoint_ms, channel_head_msg_id, open_children, handled_set, ... }
  -- recovery da failure (§5.10)
  recovery_policy_json TEXT,                -- policy di recovery transient/semantic; ereditabile da node/orchestrator
  failure_class  TEXT,                      -- null a meno che failed: 'transient' | 'semantic'
  nonprogress_consecutive INTEGER NOT NULL DEFAULT 0,  -- si resetta a ogni gate cleared (contatore semantic_after)
  nonprogress_total       INTEGER NOT NULL DEFAULT 0,  -- non si resetta mai (backstop hard_cap)
  -- chain template (§6.9)
  resolved_chain_json     TEXT,             -- il piano forward esplicito della chain: step Layer-1 + gate Layer-2,
                                            -- con stato reached/pending per step; il completeness contract
  worktree_lease_json     TEXT,             -- { held_by, state: leased|free, acquired_at_ms } (§6.9.6)
  -- generale
  plan_id        TEXT,
  conv_id        TEXT,                      -- ref OPACO al channel workstream; == id per convenzione
  worktree_path  TEXT,                      -- nullable; epics/nodes possono non averne uno proprio
  fork_base      TEXT,                      -- branch da cui questo container ha fatto fork (§6.9.7): main, o epic/<id>
                                            -- per un figlio epic; substrate lo possiede (risolve xtrm-nr05)
  opened_at_ms   INTEGER NOT NULL,
  closed_at_ms   INTEGER,
  close_reason   TEXT,                      -- merged|abandoned|transformed|retired|failed
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX idx_containers_project_state ON containers(project_id, state);
CREATE INDEX idx_containers_owned ON containers(owned_by);
CREATE INDEX idx_containers_opened_by ON containers(opened_by);

CREATE TABLE plans (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  container_id   TEXT NOT NULL,
  schema_version TEXT NOT NULL,             -- 'seed.plan.v1'
  body_json      TEXT NOT NULL,             -- artefatto plan completo
  approval_state TEXT NOT NULL,
  approval_mode  TEXT,
  approval_at_ms INTEGER,
  approval_actor TEXT
);

CREATE TABLE issues (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL,
  container_id           TEXT,              -- impostato alla creazione (plan commit, --in-container, o mid-flight)
  class                  TEXT NOT NULL,     -- root|step|gate|advisor|followup (§6.2.1)
  title                  TEXT NOT NULL,
  type                   TEXT,              -- solo su class=root: task|bug|chore|spike|design|research
  role                   TEXT,              -- solo su non-root: executor|reviewer|<custom> (era specialist_hint)
  priority               INTEGER NOT NULL,
  contract_json          TEXT NOT NULL,     -- change contract (5 sezioni) se class=root, altrimenti step contract
                                            -- (mandate/inputs/outputs/scope/non_goals) — keyed by class (§6.2.1)
  contract_state_json    TEXT NOT NULL,
  work_state             TEXT NOT NULL,
  review_state           TEXT NOT NULL,
  chain_template         TEXT,              -- template nominato opzionale (§6.9); altrimenti risolto da type
  memory_pack_json       TEXT,
  issue_local_rules_json TEXT,
  evidence_json          TEXT,
  created_at_ms          INTEGER NOT NULL,
  updated_at_ms          INTEGER NOT NULL,
  closed_at_ms           INTEGER,
  close_reason           TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX idx_issues_project_workstate ON issues(project_id, work_state);

CREATE TABLE issue_dependencies (
  project_id  TEXT NOT NULL,
  issue_id    TEXT NOT NULL,
  depends_on  TEXT NOT NULL,
  kind        TEXT NOT NULL,                -- gate: 'blocks'|'parent-child'|'until'
                                            -- context: 'discovered-from'|'validates'|'caused-by'|'relates'|'tracks'
                                            -- lifecycle: 'supersedes'   (vedi 6.7)
  PRIMARY KEY (project_id, issue_id, depends_on, kind)
);

CREATE TABLE collision_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,
  detected_at_ms  INTEGER NOT NULL,
  container_id    TEXT,
  severity        TEXT NOT NULL,            -- 'file' | 'range' | 'semantic'
  file            TEXT NOT NULL,
  worktrees_json  TEXT NOT NULL,            -- ["wt-A", "wt-B", ...]
  hunks_json      TEXT,                     -- hunk range per-worktree
  resolved_at_ms  INTEGER,
  resolution      TEXT                      -- 'serialize' | 'unify' | 'restitch' | 'merged-clean'
);

CREATE TABLE validator_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     TEXT NOT NULL,
  issue_id       TEXT NOT NULL,
  ran_at_ms      INTEGER NOT NULL,
  contract_state TEXT NOT NULL,             -- invalid | partial | ready | waived
  body_json      TEXT NOT NULL              -- gaps, suggested_rewrite, recommended_chain
);

-- pulse / trigger / node-scheduling (§5.8)
CREATE TABLE pulse_dedup (
  project_id      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,            -- '<source>:<entity>:<event>', es. 'github:pr-50:opened'
  pulse_id        TEXT NOT NULL,
  container_id    TEXT,                      -- il container a cui questo pulse è stato mappato (null mentre è in corso)
  first_seen_ms   INTEGER NOT NULL,
  PRIMARY KEY (project_id, idempotency_key)
);

CREATE TABLE pulse_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,  -- ordine FIFO
  project_id    TEXT NOT NULL,
  node_id       TEXT NOT NULL,              -- la coda di quale nodo
  pulse_kind    TEXT NOT NULL,              -- trigger | job | message
  body_json     TEXT NOT NULL,
  enqueued_ms   INTEGER NOT NULL,
  delivered_ms  INTEGER                     -- null finché il coordinatore non l’ha preso
);
CREATE INDEX idx_pulse_queue_node ON pulse_queue(node_id, id);

CREATE TABLE triggers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  trigger_kind  TEXT NOT NULL,              -- 'schedule' | 'watch' | 'event'
  spec_json     TEXT NOT NULL,              -- espressione cron, o predicato watch, o matcher event
  coalesce_window_ms INTEGER,               -- finestra meccanica di de-dup
  max_wakes_per_period_json TEXT,           -- rate-limit meccanico
  enabled       INTEGER NOT NULL DEFAULT 1
);

-- memory (§10): fatti + metadati; i livelli sono query, non una colonna
CREATE TABLE memories (
  id              TEXT PRIMARY KEY,         -- mem-7f3a
  project_id      TEXT NOT NULL,
  type            TEXT,                     -- 'bug'|'hint'|'best_practice'|'failure' (classificatore ortogonale)
  created_by_role TEXT,                     -- 'executor' | 'reviewer' | ... (query a livello identità)
  created_by_job  TEXT,
  in_container    TEXT,                     -- 'node:research' (query a livello workgroup)
  reason          TEXT,
  body            TEXT NOT NULL,            -- indicizzato FTS5
  created_ms      INTEGER NOT NULL
);
CREATE INDEX idx_memories_project ON memories(project_id);
CREATE INDEX idx_memories_container ON memories(in_container);
CREATE INDEX idx_memories_role ON memories(created_by_role, project_id);
CREATE INDEX idx_memories_type ON memories(type, project_id);
-- + tabella virtuale FTS5 su memories.body
```

### 13.4 Tabelle del dominio channels e del dominio specialists

Entrambi vivono nello stesso `state.db`, posseduto dai rispettivi package.

**dominio channels** — `channel_messages`, `channel_subscriptions` (messaggi tipizzati secondo channels.md). Ogni messaggio porta **due identificatori**: un `seq` locale al canale (`INTEGER AUTOINCREMENT`, l’ordinamento + cursore per cursor-through-N) **e** un hash `msg_id` globalmente unico (stile Slack/Discord, es. `msg_a1b2c3…`). Il `seq` ha senso solo all’interno del suo canale; il `msg_id` è l’handle globale stabile usato per riferirsi a un messaggio dall’esterno — da un altro canale, dalle evidenze di un issue, da un journal del coordinatore (§5.9), dalla provenance. Servono entrambi: `seq` per ordine/cursore, `msg_id` per identità/riferimento.

**dominio specialists** — `jobs`, `runner_events`, `tether_hints`, `telemetry_samples`. Nessuna colonna `project_id`; le stringhe `workstream_id` assomigliano a `chain:7f3a` perché substrate le ha denominate, ma specialists le tratta come opache. (Schemi completi in channels.md / tether.md.)

Nessun dominio mantiene una foreign key verso le tabelle di substrate (§13.1) — la correlazione avviene tramite ID opachi anche se si tratta dello stesso db.

### 13.5 Archiviazione degli artifact di piano

I piani vengono archiviati come blob JSON (l’artifact v1) nella tabella `plans` di substrate. Il versionamento dello schema è esplicito tramite `schema_version`; i vecchi piani vengono renderizzati sotto qualunque schema con cui sono stati scritti. Il piano viene anche dual-written nel canale seed come body di un messaggio `system.done`, così la cronologia del canale è un unico stream riproducibile — ma la copia canonica è la riga `plans`.

### 13.6 Sync multi-macchina

Fuori scope per v0. Ogni macchina ha il proprio `state.db` condiviso; i dati non ti seguono tra laptop / desktop / CI. `project_id` è un UUID proprio perché un futuro layer di sync (Dolt, LiteFS, o un servizio backend) sia fattibile senza riprogettare lo schema. Non promettere portabilità finché non è costruita.

### 13.7 Migrazione da bd

L’attuale sp + bd + materializer GitHub è **usa e getta** (§17). Non lo porteremo avanti, quindi bd → substrate **non** è un esercizio di coesistenza tramite shim. È una migrazione dati una tantum: leggere gli issue bd esistenti, mapparli nello schema issue di substrate (best-effort — la `description` in prosa di bd diventa `contract.problem`, con `contract_state` valutato `partial`/`invalid` dal validator così le lacune emergono), scriverli in `state.db`, quindi ripuntare i consumer all’API di substrate. Gli issue bd legacy che non soddisfano ancora la soglia del contratto vengono importati con `work_state` invariato e un `contract_state` che segnala cosa manca; nulla viene scartato silenziosamente. Dopo il cutover, bd è archiviale in sola lettura oppure rimosso del tutto. Nessuno shim di lungo periodo, nessun debito di dual-write.
## 14. Questioni aperte

**Risolte dalla revisione 0:** nomi dei moduli fissati (core/substrate/channels/specialists/console, binari `xt`/`sb`/`sp`); correlazione tramite ID opaco tra domini (§13.1); lo store di substrate è condiviso di default tramite un singolo daemon (§13.2); nomi dei moduli fissati (core/substrate/specialists/console, binari `xt`/`sb`/`sp`); tether è il nome confermato; il feed unificato è una fusione di `sp feed -f` + `sb feed -f`, non un unico comando enorme; la sincronizzazione multi-macchina è esplicitamente rinviata al post-v0 (§13.6).

**Risolte nella revisione 2:** le conversazioni sono rinominate **channels** (ID con due punti, quindi container ID = channel workstream ID, §7); **substrate possiede gli epics** — `sp epic` rimosso, `sb container merge` è l’unico merge canonico e funziona perché substrate possiede il fork-base (§2, §4); `scrutiny` (generico, neutrale rispetto al dominio) sostituisce `risk`, con la tabella di auto-escalation specifica per il codice che vive nella config distribuita, non nel core (§6.6); obligations/ddiff/release-checklist integrati genericamente; il materializer sp+bd+GitHub è **usa e getta**, quindi bd→substrate è una migrazione dati pulita, non uno shim di coesistenza (§13.7); forma dell’API abbozzata (§17).

**Risolte nella revisione 3:** il **sistema di relazioni tra issue** è di prima classe — nove tipi di relazione classificati per effetto runtime (gate / context / lifecycle / tracing), con solo `blocks`/`parent-child`/`until` che bloccano il dispatch (§6.7); la membership (`container_id`, una proprietà) resta distinta dalla relationship (un edge); **la creazione delle issue è disaccoppiata dal dispatch** — le issue nascono all’approvazione del piano o tramite `sb issue create --in-container` (incluso `discovered-from` in corso d’opera), e `sb dispatch <id>` non porta container/parent perché l’issue li possiede già (§6.4); la **coesistenza container-channel** è esplicitata — aprire un container apre il suo channel, e uno specialist dispatched vi entra automaticamente tramite risoluzione spec-template→active-subscription al momento dello spawn, spostando chi-parla-con-chi fuori dallo stato dell’orchestrator (§7.1); la **profondità del context è in due flussi** — channels per la lettura live, substrate `evidence` per il context persistito, con i risultati degli specialist dual-written così il tracing non dipende mai dalla sopravvivenza di un channel (§6.8).

**Risolte nella revisione 4:** il modello di container è ora un **lifecycle astratto** (`open → working → converging → ready → closed`, + `escalated`) specializzato per kind, ed è ciò che rende il sistema adattabile a workflow non di coding (§3); **preflight è diventato il container kind `seed`** — un container di pianificazione che si trasforma nel container che ha prodotto (§4.1, §5); **`node` è il quinto kind permanente** — un coordinator autonomo e long-running che apre child containers entro una policy di autonomia, con scheduling meccanico nel daemon e scheduling semantico nel coordinator (§4.2, §5.8); **tre assi** separano membership / provenance (immutabile) / ownership (mutabile), con l’ultimo che risolve gestione degli orfani ed escalation di ownership (§2.6); **emitter + pulse** sono il layer di segnalazione, con dedup tramite idempotency-key, e la policy di autonomia del node = capability dell’emitter = `can_open_containers` (un unico modello di capability, §2.3, §5.8); **il lifecycle dello specialist è esso stesso pulses**, quindi il respawn del coordinator è un pulse handler, non codice speciale (§5.8); la **context-window del coordinator** è limitata (max ~2 compactions → kill+respawn), il coordinator è stateless rispetto al node, e un respawn ricostruisce da origin-seed scope + channel recente + un **journal con state snapshot per gap-detection** (§5.9); **participant** è l’astrazione di membership (specialist è un kind; scripts/services/coordinators/external sono altri), esponendo una **superficie SDK** riutilizzabile (participant definition, pulse, channel client, command surface) così i nuovi attori sono schemi compilati, non nuovo runtime (§2.2, §2.4); **cosa NON è un container** è dichiarato esplicitamente (§2.5); **single store** — un solo `~/.xtrm/state.db`, un solo daemon, domini namespaced, ownership nel codice, nessuna FK cross-domain (§13.1); channels è diventato un **pacchetto standalone** con le proprie tabelle di dominio, e i messaggi portano un hash globale `msg_id` oltre al `seq` locale al channel (§13.4); **memory** è facts+metadata con herd/workgroup/identity come **consumer queries, non un field**, retention per-query (§10).

**Risolte nella revisione 5:** tre percorsi espliciti di creazione issue sono di prima classe fin dall’inizio di §6.4 — plan-approval (planning), CLI inline in un container esistente con contract completo + `--dispatch` opzionale (direct), e materializzazione mid-flight da proposal/escalation (discovery); “le issue nascono all’approvazione del piano” è stato declassato da *il* percorso a *uno* dei percorsi (§6.4); il **validator è a due stadi** — schema-check programmatico sempre (gratis, hard-rejects incomplete, soft-flags thin), giudizio agentico del modello solo su richiesta o dentro un seed, quindi l’hot path non è mai bloccato da un modello (§6.3); il **panel di advisor è configurabile** — l’orchestrator può eseguire un seed minimal/sole-advisor o `system.invite` extras, planner e memory-curator sono soft-mandatory non rule-gated, l’operator può suggerire (§5.2, risolve la vecchia open-Q #2).

**Risolte nella revisione 6:** **failure recovery** è un meccanismo nominato (§5.10) costruito solo da pezzi esistenti — nessuna nuova entità, nessun "watchdog": i counter sono stato del container, il daemon osserva ed emette lifecycle pulses (§5.8), gli handler reagiscono. Ogni terminazione non pulita porta `failure_class: transient | semantic`; il normale review loop entro soglia *non* è un failure (è ddiff, §3); semantic failure scatta a una soglia di non-progress — `semantic_after` consecutivi (si resetta su progress) più un generoso `hard_cap` totale (backstop anti-oscillazione) — contato a *qualsiasi* gate; i semantic failures escalano **in modo graduato** (prima orchestrator, operator solo oltre policy); i transient failures ritentano identicamente entro policy; **il lavoro non viene mai distrutto su failure** (`closed:failed`/`escalated`, mai auto-`abandoned`; worktree + evidence preservati); il materiale preservato viene *ripreso* (transient) o *migliorato* (semantic); e un semantic failure **distilla una memory `type: failure`** così i seed futuri recuperano “questo è stato tentato ed è fallito perché X” (§10) — failure recovery è generativo, non solo difensivo. Lo schema aggiunge `failure_class`, `recovery_policy_json`, i due counter di non-progress, `close_reason=failed` (§13.3); memory aggiunge un classifier `type` (§10.1). Risolve la vecchia open-Q #1.

**Risolte nella revisione 7:** **workflows** è un meccanismo nominato (§6.9) che stabilisce, una volta per tutte, come una chain avanza — la domanda precedentemente ambigua su chi guida il dispatch step-to-step. **L’avanzamento è workflow-driven, eseguito da substrate, osservato dall’orchestrator** (§3, §6.9.1): l’orchestrator apre una chain e osserva, intervenendo solo sulle eccezioni, invece di avviare ogni step routinario a mano (che è dove diventava pigro — reviewer saltati, debugger dimenticati). La **resolved form di un workflow è persisted container state** (§6.9.2), fornendo overview/preheat, un completeness contract che il daemon verifica prima di `merge_ready`, e pre-allocation. I workflows hanno **due layer** (§6.9.3): Layer 1 = step domain-specific in `config/workflows/` (defaults + custom per-repo, nesting dentro bookend executor/reviewer, con auto-match `applies_when`); Layer 2 = mandatory gates (code-sanity + obligations-scanner sui production diffs, security-auditor su sensitive surface) sovrapposti da risk/surface indipendentemente dal workflow scelto, con skip exceptions codificate e unauthorized-skip = escalation. La resolution avviene per default di issue-type (`bug` → `debug` con debugger non-skippable), `--workflow` esplicito, o auto-match (§6.9.4); un workflow **suggerisce salvo `--strict`**, ma il mandatory layer non è mai waived. Il resolved workflow è **mutabile in flight** (§6.9.5): membri entrano mid-run tramite operator (a mano), orchestrator (judgment entro policy), o daemon (solo deterministic codified rules), con le inserzioni daemon che vivono dentro i §5.10 non-progress counters così non possono ciclare. Lo schema aggiunge `resolved_workflow_json` sui containers e `workflow` sulle issues (§13.3); `recommended_chain` diventa `recommended_workflow` (§6.3).

**Risolte nella revisione 8:** questioni aperte minori con orientamento chiaro chiuse — nesting dei container **soft-capped a 2 livelli** (warning/escalation oltre, non hard-block; soglia esatta rinviata, #3); lifecycle del daemon **lazy-launch** al primo comando con `sb daemon status/stop` (#9). Le domande in cui la risposta onesta è “decideranno le run reali” sono state esplicitamente segnate **rinviate al prossimo agent** invece di tirare a indovinare (#5 issue-local conflict, #6 session-level curator, #11 node nesting depth legata all’autonomia desiderata, #12 dispatch_mode predicate). Aggiunta **§14.1 Domande per il prossimo agent** — organizzate in base a ciò che il prossimo agent avrà e questo design pass non aveva: visibilità del codice (`runner.ts`/`coordinator.ts`, il concetto di turn del pi-runtime, i daemon-observes hooks, protocollo di coordinamento cross-container), trascritti di run passate (quali workflows ricorrono davvero, dove l’orchestrator diventa davvero pigro, se la distinzione transient/semantic failure regge), ed esplorazione esterna (scelta database engine, repo beads, neutralità di dominio del sistema issue). Il principale item di *design* restante, #7 (per-issue close flow rispetto allo stato container), è segnalato per un pass dedicato.

**Risolte nella revisione 9:** il concetto di workflow è rinominato **chain_template** e approfondito sostanzialmente (§6.9, prima "Workflows" → "Chain templates and composition") — "workflow" non compare più, l’unità è la chain. **Ogni dispatch è step-issue-backed** (§6.9.2): una root porta un *change contract* (le cinque sezioni), uno step porta uno *step contract* (mandate/inputs/outputs/scope) — due forme oneste, non uno stampo forzato — recuperando la proprietà bd di durable-inspectable-contract; la composizione del prompt è esplicita e layered così un participant riceve il suo role invece di inferirlo. **La composition avviene in due momenti con informazioni crescenti** (§6.9.5): container composition al seed-time (epic/wave/chain kind; planner esteso per proporre la forma di ciascuna chain) e chain composition pre-dispatch (orchestrator rifinisce con informazioni dalle sibling-chain), più mid-run insertion come terzo; il **composition gate** (`sb chain review` / `insert` / `approve`) forza la valutazione della shape prima che una chain entri in `working`, l’analogo della seed approval, auto sotto policy. Tre livelli di nudge lo alimentano — L1 programmatic (solleva la domanda), L2 issue-type, L3 orchestrator judgment (decide) — il modello giudica, il layer programmatico rende solo inevitabile la domanda. L’**orchestrator è formalizzato come estensione tecnica e giudice della visione dell’operator** — micro-management rimosso, composition judgment aumentato. Un **chain_template ha tre origins** (§6.9.4): pre-built, type-resolved, on-the-run, con ciclo di promozione ad-hoc→formalized→engineered. Il **worktree lease** (§6.9.6) formalizza un-active-writer-at-a-time: gli writer-steps acquisiscono/rilasciano, gli read-only steps non lo toccano, il daemon serializza, e l’handoff executor→debugger è sequential writers su un worktree. Il **git model ha due assi** (§6.9.7): container kind (come le roots si relazionano) vs. chain shape (gli steps di una root); epic ha una shared integration base (children fork da `epic/<id>`, si vedono tra loro), wave ha independent bases (children fork da main, collision-watched); i nomi dei worktree ereditano la gerarchia (`wt/epic-<id>/chain-<id>`). I **deliberative issue types** (`design`, `research`) defaultano a deliberative templates che chiudono con outcome `decision` (§6.9.8). L’issue ottiene **tre classifiers non sovrapposti** (§6.2.1): `class` (funzione strutturale: root/step/gate/advisor/followup — stored, non derived, così il sistema tratta correttamente anche custom specialists sconosciuti e la gate-ness è strutturalmente enforced contro la pigrizia), `type` (kind del root work, solo su `class:root`, `decision` rimosso perché è un outcome, non un classifier), `role` (chi esegue, era `specialist_hint`, può essere un custom specialist; lo stesso role può avere classi diverse per posizione — researcher-as-gate). Una root non è directly dispatchable — richiede ≥1 step, enforced dal gate `sb chain approve`. Le nove relationships (§6.7) restano invariate; due edge proposti (`informs`, `spawned_by`) sono registrati come split futuri, sussunti da `relates`/`discovered_from` finché un uso non li distingue. Schema: `resolved_chain_json` + `worktree_lease_json` sui containers, `class`/`type`/`role`/`chain_template` sulle issues (`specialist_hint`→`role`); `recommended_workflow` → `recommended_template`; la CLI aggiunge `sb chain-template ls/show`, `sb chain review/insert/approve`, `sb issue ls --class`. Un grounding pass ha riconciliato le vecchie sezioni node con la nuova struttura: **la collaborazione cross-container avviene tramite pulse, non channel** (§4.2, §5.8, channels restano container-scoped, risolve la contraddizione in channels.md); **un node coordinator compone e auto-approva le chains che apre entro la sua autonomy policy** (§5.8, l’adattamento node del composition gate); `sb dispatch` è chiarito come dispatch di una *root* e *compose della sua chain* (§6.4); lo schema aggiunge `fork_base` (substrate lo possiede, §6.9.7), `coordinator_journal_json` (node respawn state, §5.9), e `contract_json` è annotato come capace di contenere entrambi i contract kind per class; la dashboard card mostra chain shape con reached/pending steps e lease holder. **Runtime alignment** (§3.1, verificato contro il pi runtime dalla specialists-runtime review) stabilisce come un container avanza davvero: event-driven su member `agent_end`/pulse/`sb` command, mai wall-clock tick e mai live-stream text; `waiting` = pi keep-alive dopo `agent_end`; il daemon è un secondo reader dell’observability stream esistente (nessun nuovo hook); `transient` failure = envelope `auto_retry_*` di pi. Un **precondition gate** (§6.4) è aggiunto come check a dispatch-time distinto dalla §5.10 recovery (*non avremmo dovuto iniziare* vs *abbiamo iniziato e inciampato*), rifiutando con un envelope strutturato e override `--allow-unready --reason` audit-traceable. Questo risolve le domande §14.1 su turn-concept e daemon-observes e corregge i riferimenti pendenti §19/§20 in §6.9.6. **Il per-issue close flow** (§6.10, risolvendo open-Q #7) rende la close una *derivazione*: `close_ready` (nuovo work-state) è l’analogo per-issue del `ready` del container; i membri chiudono transazionalmente a `sb container merge`, non nel momento in cui sono individualmente soddisfatti (l’unica eccezione è `followup` non-blocking); la container-failed cascade è un §5.8 pulse handler che preserva evidence. I tre bd shims sono **eliminati tramite riuso** — memory-ack → distillazione `type:failure` di §5.10, commit-gate → dual-write di §6.8, Stop hook → participant-`waiting` di §3.1 (claims appartengono ai jobs, non alle sessions). `done`/`archived` derivano deterministicamente da `close_reason` (quindi `failed` lascia il work_state enum); `decided` è il close_reason per le deliberative roots; reopen consentito solo da `abandoned|failed-*|superseded`. Non c’è routine `gate-failed` close — un gate insoddisfatto blocca (§6.9.2) o cascada. L’envelope di rifiuto strutturato è condiviso con §6.4 e channels.md §10.2. **Sei default chain_templates distribuiti** (§6.9.10) sono catalogati — `code-quick`, `code-standard`, `code-with-advisors`, `debug`, `quantitative-validation`, `security-deep` — estratti da chain reali dalla specialists-runtime review (non inventati), scritti flat (nessun `extends`, rinviato), con Layer-2 gates sovrapposti a tutti; il `debug` con `debugger` non-skippable e `quant-validation` con `quant-methodologist` non-skippable chiudono strutturalmente le corrispondenti modalità di pigrizia, e `security-deep` dimostra lo stesso role in due classi (advisor pre-, gate post-). Questo risolve parzialmente la domanda §14.1 “quali templates ricorrono” (sei trovati, altri attendono un corpus di transcript più ampio). §6.9.10 inquadra i sei come archetipi/floor concettuali e nota che il runtime distribuisce un catalogo `bd formula` più ampio e basato su evidence (attualmente tredici), riconciliato con la specialists-runtime roadmap.

**Risolte nella revisione 10:** il **chain coordinator** (§4.3) diventa un participant di prima classe di ogni chain — un giudice permanente di un container transiente, parallelo nella forma al node coordinator (§4.2) ma scoped alla lifetime di una chain. Spawna al completamento della composition (dopo `sb chain approve`, prima del dispatch dello step-1) e svolge quattro ruoli: **entry gate** (con context fresco, valida la chain shape dall’interno; inserisce steps entro la policy `autonomy_json`; emette `verdict: ready` e solo allora il daemon dispatcha step-1 — piccolo refinement a §3.1); **borderline judge** durante l’esecuzione (interpreta casi che il reducer §6.10 non può decidere da solo: gate findings ambigui, evidence borderline); **cross-chain hygiene coordinator** tramite pulse (collision alerts, gate-state advertisements, wait-for-me requests — meccanica, non visione; la visione resta con l’orchestrator); **close-time judge** (conferma `close_ready`, verifica git-clean *davvero*, distilla memories `type:failure` / `type:best_practice`, propone issue `class: followup` per findings out-of-scope tramite `--rel discovered-from:<root>`, rilascia la chain a `sb container merge`). Subordinato all’orchestrator (stesso pattern di escalation del node coordinator, §5.8). **Nessun privileged read path**: legge il channel come qualsiasi participant (§6.8) per live coordination e interroga `issue.evidence_json` per structured close-time tracing — entrambe sono superfici pubbliche. **Model selection per chain_template** (§6.9.10): `code-quick` → small free-tier (o `null`); `code-standard` → mid-tier; `code-with-advisors` / `security-deep` / `quantitative-validation` → top-tier; l’operator può override per-chain. Lifecycle limitato alla lifetime della chain — nessun journal tra sessions (le chains sono transienti, a differenza dei nodes di §5.9). **Memory access è rimodellato** (§10.2): il dedicated `memory-curator` specialist role è **eliminato** a entrambe le estremità. Memory access diventa una **capability che ogni participant porta** tramite una mandatory memory-query extension (analoga all’iniezione `ISSUE_LOCAL_RULES`, §6.5) — il planner interroga a seed-time durante planning, gli specialists interrogano a run-time quando il loro lavoro lo richiede, nessun advisor di pre-mastication in mezzo. **Memory distillation passa al closing judge**: il chain coordinator alla close della chain, il node coordinator alla close del node, l’operator sui seed escalated; un attore per container kind, quello con full read su ciò che è appena accaduto (§5.10 aggiornato per nominare genericamente il closing judge). Il relevance check Layer-2 del tether resta invariato (meccanismo indipendente, §8). Anche due domande aperte §14 sono risolte dalla rev10: **#5 (issue-local rule conflict)** ora è **moot sotto il modello step-issue della rev9** — un reviewer è uno step di una chain, vede solo evidence di quella chain, cross-chain reading non avviene (channels container-scoped, channels.md §15.2), quindi il conflitto-by-construction è impossibile; **#6 (session-start memory curator)** è **superseded dalla riscrittura §10.2** — non esiste curator, ogni participant interroga direttamente. Summary (§16), nota cross-cutting facilities di §2, lista advisor-invite §5.2, esempio seed §5.7, riferimenti §6.7 / §6.8, e dashboard card sono aggiornati di conseguenza. Lo schema aggiunge `autonomy_json` e `chain_coordinator_model` sui chain containers (§13.3, paralleli ai fields node).

Ancora aperte:

1. *(Risolta in rev6, §5.10.)* Seed/container failure non scarta mai lavoro — un seed fallito preserva i suoi findings incrementally-persisted, e `sb seed rerun` costruisce su di essi invece di ripartire da zero; i running containers falliti preservano worktree + evidence.

2. *(Risolta in rev5, §5.2.)* Configurabilità dell’advisor panel — l’orchestrator può aggiungere advisors tramite `system.invite`, eseguire un seed minimal/sole-advisor, planner + memory-curator sono soft-mandatory, l’operator può suggerire.

3. *(Risolta in rev8, soft cap.)* Il nesting dei container è **soft-capped a 2 livelli** (wave-of-chains, epic-of-chains). Un nesting più profondo non è hard-blocked ma solleva warning/escalation come uno skip di gate non autorizzato — “nesting oltre 2 livelli è insolito, conferma o decomponi.” Forza decomposition pulita nel caso comune (nested epics sono di solito uno scope smell) senza bloccare un caso raro ma legittimo. **Soglia esatta rinviata al prossimo agent**, che potrà vedere da run reali se 2 regge o 3 emerge naturalmente.

4. **Plan-as-channel-message vs. plan-as-table.** Risolta verso dual-write (copia canonica nella tabella `plans` di substrate; copia di replay come body `system.done` nel channel). Tenuta in tracking nel caso la duplicazione causi drift.

5. *(Risolta in rev10, moot sotto il modello step-issue della rev9.)* **Issue-local rule conflict.** Lo scenario che ha motivato questa domanda — “reviewer jobbed su issue A legge diff da issue B; quali rules si applicano?” — non si presenta sotto il modello step-issue della rev9. Un reviewer è una step-issue di una chain, legge solo l’evidence della sua chain, mai il diff di un’altra chain (channels sono container-scoped per channels.md §15.2; cross-chain reading non avviene). Il conflitto-by-construction è impossibile. Lo scope delle rules è stabilito: il prompt di un participant porta le rules dell’issue che lo ha spawnato, punto.

6. *(Risolta in rev10, superseded da §10.2.)* **Memory curator a session start vs. seed.** Superseded: non c’è più un curator dedicato. Memory access è una capability che ogni participant porta (§10.2); ciascuno recupera ciò di cui ha bisogno quando il proprio lavoro lo richiede. Un session-level curator è inutile — l’orchestrator e qualunque participant interrogano memory direttamente tramite extension quando il context lo richiede.

7. *(Risolta in §6.10.)* **Cosa sostituisce la semantica di `bd close`.** Close è una *derivazione*, non un imperativo: un’issue raggiunge `close_ready` quando la sua evidence soddisfa, il container raggiunge `ready` quando tutti i membri sono `close_ready`, e `sb container merge` chiude transazionalmente ogni membro. I tre bd shims (memory-ack, commit-gate, Stop hook) sono eliminati tramite riuso di §5.10 / §6.8 / §3.1, non migrati. `done` vs `archived` derivano da `close_reason`.

8. **Cross-container coordination.** *(Risolta nella direzione, protocollo rinviato.)* I peer node coordinators collaborano tramite **cross-container pulses** (§2.3, §4.2), non osservando i channels reciproci — channels restano container-scoped per channels.md. Un peer emette un pulse su una key documentata; il receiver si sveglia su di essa. Le esatte convenzioni delle key e l’autorità cross-container per i pulses sono il dettaglio restante, da risolvere contro l’implementazione pulse/trigger.

9. *(Risolta in rev8, lazy.)* Lifecycle del daemon è **lazy-launch al primo comando** (nessuna frizione), con `sb daemon status` / `sb daemon stop` per controllo, e le regole file-lock + PID-aware cleanup (§13.2). Corrisponde al modello index-process di git; nessuno start step esplicito richiesto.

10. **Dettaglio memory (§10.3).** Policy di pruning per-level; predicate di promotion (cosa rende una workgroup memory degna di essere tenuta project-wide); se identity è per-role-global o per-role-per-project; come la provenance di una memory interagisce con il retirement di un node. Il modello è definito; queste decisioni di tuning sono il prossimo memory-design pass.

11. **Node nesting depth cap.** *(Aperta — rinviata al prossimo agent; legata a quanta autonomia si dimostrerà utile nelle run reali.)* Un node che apre uno standing sub-node richiede escalation (§4.2); l’esatta depth cap e se i sub-nodes possano a loro volta escalare per grandchildren è non definito. La profondità giusta è una funzione dell’autonomia desiderata, che si scopre osservando cosa fanno davvero i nodes — non decidibile a tavolino. La regola attuale (sub-node richiede escalation) vale nel frattempo.

12. **`dispatch_mode` predicate.** *(Aperta — rinviata al prossimo agent; le run reali mostreranno quali task shapes ricorrono.)* Per-node `direct | via_seed` è deciso; resta aperto se debba essere un predicate più ricco (direct per task shapes note, via_seed per quelle ambigue, valutato per pulse).

### 14.1 Domande per il prossimo agent (visibilità su codice + run-transcript)

Questo design è stato sviluppato a livello architetturale, deliberatamente *senza* leggere il codebase degli specialist o i transcript delle run passate. Il prossimo agent avrà entrambi. Queste domande sono quelle che richiedono esattamente questo — realtà del codice e comportamento osservato nelle run — per ricevere una buona risposta; rispondere a tavolino sarebbe tirare a indovinare. Sono raggruppate in base a ciò che richiedono.

**Richiede lettura del runtime code (`runner.ts`, `coordinator.ts`, il pi-coding-agent runtime):**

- **Il concetto di "turn".** *(Risolta in §3.1.)* Il turn di Pi è l’heartbeat del runtime; substrate si allinea a esso invece di inventare un tick separato. Il reducer di un container è event-driven su member `turn_end`/`agent_end`, arrivo di pulse, o comando `sb` — mai wall-clock tick. `waiting` = pi keep-alive dopo `agent_end`. (Verificato contro `runner.ts`/`supervisor.ts`/`pi-rpc.md` dalla specialists-runtime review.)
- **Il modello daemon-observes.** *(Risolta in §3.1.)* Sì — il daemon è un secondo reader dell’observability stream che il supervisor già scrive (le rows lette da `sp log`); i lifecycle pulses vengono emessi come side effect di quelle rows, nessuna nuova instrumentation.
- **Cross-container pulse conventions (open-Q #8).** I peer node coordinators collaborano tramite cross-container pulses (§2.3, §4.2), non channel-watching — channels restano container-scoped. Le key conventions e la cross-container pulse authority sono il dettaglio restante; risolvere contro l’implementazione pulse/trigger e channels.md.
- **Cross-container pulse conventions (open-Q #8).** I peer node coordinators collaborano tramite cross-container pulses (§2.3, §4.2), non channel-watching — channels restano container-scoped. Le key conventions e la cross-container pulse authority sono il dettaglio restante; risolvere contro l’implementazione pulse/trigger e channels.md.

**Richiede lettura di transcript di run passate (cosa è emerso naturalmente nel tempo):**

- **Quali chain_templates ricorrono oltre le prime sei?** *(Parzialmente risolta in §6.9.10.)* Sei default templates sono stati estratti da chain reali (mercury 2026-05-25, specialists 2026-05-26) e distribuiti. Sono un floor, non un insieme chiuso — ci si aspetta che il mining di più transcripts faccia emergere altri degni di formalizzazione (§6.9.4 promotion cycle). Il task restante è trovare il prossimo batch da un corpus di transcript più ampio.
- **Dove l’orchestrator diventa davvero pigro?** §6.9.1 afferma che l’orchestrator salta reviewer e dimentica debugger sotto pressione. I transcripts dovrebbero confermare *quali* steps vengono saltati più spesso, il che valida (o corregge) quali gates devono essere mandatory (Layer 2) vs. meramente default.
- **Le failure classes (§5.10) corrispondono ai failure osservati?** La divisione transient/semantic è un’ipotesi. I failure reali nei transcripts mostreranno se quel binario è sufficiente o se emerge una terza classe, e se le soglie `semantic_after`/`hard_cap` sono calibrate correttamente.
- **Open-Qs #5, #6, #12** — ciascuna è stata lasciata aperta proprio perché le run reali rispondono meglio del design: issue-local rule conflict (#5) si verifica mai davvero; manca context a session start tale da giustificare un session-level curator (#6); quali task shapes ricorrono abbastanza spesso da giustificare un `dispatch_mode` predicate più ricco (#12).

**Richiede esplorazione esterna (altri codebase / decisioni infrastrutturali):**

- **La scelta del database (§13).** Dolt vs. sqlite vs. dolt:sqlite (commits/push, doltlab), bun come framework, un backup JSON automatico versionabile per-project. Lo store globale crescerà rapidamente, il che spinge verso storage nativo-versioning — ma questa è una decisione infrastrutturale che richiede benchmark reali (cosa regge con il global db in crescita), non una scelta a tavolino. Il design si impegna solo a “single store, one daemon, correlazione opaque-ID così può essere ri-separato più tardi” (§13.1); il motore concreto resta aperto.
- **Esplorare il repo beads.** Per evitare di reinventare meccaniche (specialmente dependency handling) che beads ha già risolto. Il modello a nove relationship (§6.7) e la tabella edge issue_dependencies dovrebbero essere confrontati con come beads gestisce davvero le dependencies prima dell’implementazione.
- **Neutralità di dominio dell’issue-system.** `contract.scope` dell’issue è una glob-list, specifica del codice; il sistema deve servire anche lavoro non-coding. Decidere se i contract fields diventano generici o ottengono varianti per-domain, e progettare la skill agent-guided di config per-repo (`config/substrate/`, con update mechanism) che §6.6 già implica. Parte design, parte decisione tooling che tocca il codebase.

**La direzione big-picture (non una domanda, un’ambizione segnalata):** la visione pipeline stile n8n (§18 operator notes) — nodes + pulse + un SDK completo che abiliti pipeline automatizzate create da agenti, con connectors (Discord, Gmail) che hanno chiari `emit pulse` + accesso SDK. Questa è la north star verso cui la superficie SDK (§2.4) viene modellata; il prossimo agent dovrebbe tenerla presente quando valuta se l’SDK è sufficientemente completo da scrivere un connector.

---

## 15. Sequenziamento

Non un piano di migrazione; solo ordine di dipendenza per completezza del design.

| Stage | Cosa viene rilasciato | Dipende da |
|---|---|---|
| 0 | Substrate store + shared daemon (`state.db`, Unix socket, project registration, file-lock launch) | — |
| 1 | Nuovo issue schema + Stage-1 programmatic validator (schema gate) | 0 |
| 2 | Channels v0 (channel_messages table, `sp tail`/`sp msg`) | — |
| 3 | Tether v0 (Layer 1 matchers, forced injection) | — |
| 4 | Container entity (solo chain) + lifecycle states | 0, 1, 2 |
| 5 | Seed channel (solo memory-curator + validator advisors) | 1, 2, 4 |
| 6 | Plan artifact + approval modes | 4, 5 |
| 7 | Collision matrix (file-level) + tether collision-overlap matcher | 3, 4 |
| 8 | Epic / wave container kinds | 4, 7 |
| 9 | Advisor invite rules + full advisor set | 5 |
| 10 | Tether Layer 2 + memory curator mid-run | 3, 9 |
| 11 | Reconciler specialist | 7, 8 |
| 12 | Console renders contro merged `sp feed -f` + `sb feed -f` | 1–7 (minimum) |
| 13 | bd → substrate data migration (§13.7, non uno shim) | 1, 4 |

Ogni stage è rilasciabile e reversibile indipendentemente secondo la filosofia channels.md/tether.md. Stage 0 (daemon + store) ora guida perché ogni entità substrate ha bisogno di un posto dove vivere; eredita le lezioni duramente apprese da bd sui failure-mode (§13.2) invece di riscoprirle.
## 16. Sommario

Il substrate dà nome a ciò che l'orchestrator attualmente porta nella propria testa. Ogni unità di lavoro agent è un **container** che passa attraverso un **seed** (un **channel** strutturato tra **advisors**) per produrre un **plan artifact** che impegna **issues** nel nuovo issue store e dispatches una **chain | epic | wave** di lavoro specialist. Ogni chain ha un **chain coordinator** (§4.3) — un giudice permanente a fresh-context che gates entry, giudica borderline evidence, coordina cross-chain hygiene by pulse, e distilla memory alla chiusura; ogni node ha il proprio coordinator (§4.2). Ogni running job è decorato da **tether** con contesto always-on. Le modifiche cross-worktree sono osservate da una **collision matrix** live. **Memory** è interrogata come capability da ogni participant (nessun curator dedicato) e distillata alla chiusura dal coordinator. La **dashboard** è un renderer sopra lo stato runtime; la **CLI** espone lo stesso stato.

Il runtime modella le entities. La dashboard le rivela. L'orchestrator e il node-coordinator le guidano tramite la stessa CLI che userebbe un umano. C'è una sola source of truth e tre readers.

---

## 17. Superficie API & consumers (bozza)

> **Status: draft.** Le forme a livello endpoint sono rimandate. Ma la *shape* sotto — tre faces, un native monotonic cursor, correlazione opaque, una read-live bias per substrate — è decisa abbastanza da costruirci sopra.

substrate è un **local long-running daemon**, uno per macchina, sole owner e sole writer di `state.db` (§13.2). È authoritative e read-write per il suo dominio (issues, containers, plans, collisions, validator). Questo è ciò che lo distingue da una *projection*: una projection è una copia read-only ricostruibile; l'engine *owns the truth*. L'authoring è nativo in substrate, non write-through verso qualche altro store. I suoi tre clients leggono la stessa surface: la `sb` CLI, la xtrm console, e l'orchestrator. Una source of truth, tre readers.

### 17.1 Tre faces

L'API ha tre faces perché hanno consumers diversi e garanzie diverse.

**Query (read).**
- Issues: get by id; list with filters (project, work_state, contract_state, container); issue + dependencies.
- Containers: get; list; tree view (for nesting); "inside a container" (issues + plan + channel ref).
- Plans: get; list by container.
- Collisions: list; per-file.
- Validator: latest run per issue.
- **Snapshot:** stato corrente completo di un project, per cold-start / resync.

**Change-tracking (la headline face).**
- Un **native monotonic cursor**: `changesSince(cursor) → { created, updated, deleted, newCursor }`. Poiché substrate possiede il proprio store, può garantire una clean monotonic change sequence (un `seq` o `updated_at_ms` watermark sulle sue rows). Questo è *perché* substrate è una backing source migliore di bd: non c'è ambiguità Dolt commit-vs-working-set (la frizione ricorrente nel vecchio sistema) perché non c'è Dolt — c'è uno store che controlli e che ti consegna il cursor gratis.
- Uno **stream** (`feed`, server-streaming sopra il socket): emette change events mentre accadono. Questo è il realtime channel.

**Command (write).**
- Issue: create (esegue Stage-1 validation), update (re-validates), validate (Stage-2 on demand), dispatch (the gate).
- Seed: start, status, approve, reject, rerun.
- Container: serialize, unify, pause, resume, merge, abandon.
- I commands mutano `state.db` ed emettono events sul feed.

### 17.2 Nessun adapter ereditato — substrate defines, consumers conform

L'attuale sp + bd + GitHub materializer è **disposable**. Stiamo progettando un nuovo sistema; non pieghiamo substrate per adattarlo al vecchio integration code. Quindi la relazione si inverte rispetto alla solita backward-compat story: **substrate defines the clean API, and whatever consumes it — a new console, a rewritten materializer, or direct readers — conforms to substrate.**

La three-method read shape (`cursor()` / `changesSince()` / `snapshot()`) è mantenuta perché è il design *corretto* per uno store che possiede un monotonic cursor — non perché qualche adapter esistente la richieda. Il design guadagna quei metodi; non li eredita. Di conseguenza il path bd→substrate è una semplice data migration più repointing consumers (§13.7), non un compatibility shim long-lived.

### 17.3 Il fork: materialize substrate, o read it live?

Per GitHub e observability, materialization vince chiaramente — GitHub è remoto e rate-limited, observability è N scattered files. Ma substrate è **un singolo local store dietro un daemon che già serve fast queries e un feed.** Materializzarlo significherebbe copiare SQLite→SQLite sulla stessa macchina. Il job↔issue join che giustificherebbe una copia è esattamente il pattern §13.1 "join in the reader" (chiedi a substrate i containers, chiedi a specialists i jobs dietro quegli IDs, stitch) — triviale a volume single-user, tens-to-hundreds-of-issues.

Quindi per substrate specificamente, la bias è **read live + join in the reader**, l'opposto della scelta giusta per GitHub/observability. Il costo è resilience: con una copia, la console sopravvive a un restart del daemon `sb`; con direct read ha bisogno di una piccola client-side last-successful cache per superare un restart. Quella cache è molto più economica di un full projection layer. Ogni source sceglie indipendentemente — substrate non deve ereditare una policy uniforme "materialize everything" solo perché il vecchio sistema ne aveva una. **Questa è l'unica decisione davvero aperta in questa sezione; plasma metà dell'API ed è lasciata all'operator.**

### 17.4 Transport & correlation

- **Transport:** Unix socket, request/response *più* streaming. CLI e console sono peer clients dello stesso socket.
- **Versioned payloads:** `seed.plan.v1`, uno versioned issue schema. L'engine evolverà; i vecchi plans devono render sotto lo schema con cui sono stati scritti.
- **Correlation resta §13.1:** l'API restituisce `conv_id`, `container_id` come opaque strings. substrate non fa mai join con specialists. Il reader stitches.

### 17.5 Naming caveat

Due cose distinte condividono la parola "substrate." Questo documento intende l'**engine**: il package `sb`, l'authoritative read-write store. È diverso da qualsiasi *projection tables* `substrate_*` che possano esistere nel vecchio gitboard refactor — quelle sono una rebuildable read-only copy e fanno parte di ciò che è disposable. Stessa parola, due referents; don't collide them.
