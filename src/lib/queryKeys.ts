/**
 * Central query-key factory. Always build keys through here so invalidation
 * stays consistent across features.
 */
export const qk = {
  /**
   * Chi sono e dove (`get_my_context`): le appartenenze, le sedi gestite con i
   * permessi, quelle in cui lavoro. Senza id: l'identità è la sessione.
   */
  context: {
    mine: ["context", "mine"] as const,
    /** L'interruttore della chat fra colleghi, per azienda. */
    staffCanChat: (workspaceId: string) =>
      ["context", "staffCanChat", workspaceId] as const,
  },
  venues: {
    all: ["venues"] as const,
    /**
     * Le sedi aperte a cui si ha accesso: le proprie se si è il titolare, quelle
     * delegate se si è un collaboratore (`venue_access`). Una lista: un account
     * può averne più di una.
     *
     * Prefisso di tutte le liste per ambito. Le invalidazioni restano larghe,
     * mentre ogni lettura usa `mineByIds`: cambiare insieme di sedi deve creare
     * una cache nuova, non riusare il risultato della query precedente.
     */
    mine: ["venues", "mine"] as const,
    mineByIds: (venueIds: readonly string[]) =>
      [
        "venues",
        "mine",
        [...new Set(venueIds)].sort().join(","),
      ] as const,
    /** Le sedi archiviate. Solo il titolare le vede: le sue, per definizione. */
    closed: (ownerId: string) => ["venues", "closed", ownerId] as const,
  },
  /**
   * I collaboratori dell'azienda: sono i `workspace_members` con
   * `authority = 'collaborator'`, con permessi e ambito sul membro.
   */
  team: {
    all: ["team"] as const,
    byWorkspace: (workspaceId: string) =>
      ["team", "byWorkspace", workspaceId] as const,
    /** I permessi attuali di un membro: la scheda da cui si promuove. */
    member: (memberId: string) => ["team", "member", memberId] as const,
  },
  profile: {
    mine: (userId: string) => ["profile", "mine", userId] as const,
  },
  /**
   * I turni sono dell'**azienda**, non di una sede: `scope` è `venuesKey`, cioè
   * gli id delle sedi aperte ordinati e uniti (vedi `OwnerVenues.tsx`).
   *
   * È così che «aprire una sede fa comparire i suoi turni» funziona da sé:
   * l'insieme delle sedi cambia → lo scope cambia → è una chiave nuova, e React
   * Query va a prenderla senza che nessuno scriva un `invalidateQueries`.
   *
   * ⚠️ **Chi invalida usa i prefissi `…Any`/`…All`, mai lo scope.** RealtimeSync
   * e le mutation non hanno `venuesKey` a portata di mano e prima o poi lo
   * sbaglierebbero; e in una sessione c'è al massimo uno scope vivo, quindi il
   * prefisso invalida esattamente una cosa.
   */
  shifts: {
    all: ["shifts"] as const,
    byOwner: (scope: string) => ["shifts", "byOwner", scope] as const,
    byOwnerAll: ["shifts", "byOwner"] as const,
    range: (scope: string, from: string, to: string) =>
      ["shifts", "range", scope, from, to] as const,
    // Prefisso: ogni intervallo già in cache (la vista calendario ne tiene più
    // di uno mentre si naviga tra le settimane).
    rangeAny: ["shifts", "range"] as const,
    /**
     * Lo storico. `filters` è `pastFiltersKey()`: i filtri passano dal server,
     * quindi ogni combinazione è una lista diversa e vuole una cache sua —
     * altrimenti tornare da "solo annullati" a "tutti" mostrerebbe per un
     * istante la lista filtrata.
     */
    past: (scope: string, filters: string) =>
      ["shifts", "past", scope, filters] as const,
    pastAll: ["shifts", "past"] as const,
    pastCount: (scope: string, filters: string) =>
      ["shifts", "pastCount", scope, filters] as const,
    pastCountAll: ["shifts", "pastCount"] as const,
    detail: (id: string) => ["shifts", "detail", id] as const,
    /**
     * Il turno **con la sua sede** (lato professionista). Chiave a parte da
     * `detail`: è lo stesso id ma un payload diverso, e finché le due query
     * condividevano la chiave vinceva quella che montava per prima — chi
     * arrivava dopo si ritrovava un turno senza `venue`, o con una `venue` che
     * il suo tipo non prevedeva.
     */
    detailWithVenue: (id: string) =>
      ["shifts", "detail", id, "venue"] as const,
  },
  reviews: {
    all: ["reviews"] as const,
    preview: (waiterId: string, limit: number) =>
      ["reviews", "preview", waiterId, limit] as const,
    page: (
      waiterId: string,
      sort: string,
      ratingFilter: number | null,
      tag: string | null
    ) =>
      ["reviews", "page", waiterId, sort, ratingFilter ?? "all", tag ?? "all"] as const,
    breakdown: (waiterId: string) => ["reviews", "breakdown", waiterId] as const,
  },
  documents: {
    all: ["documents"] as const,
    // Per membro (`staff_documents.member_id`): un membro dell'azienda ha una
    // sola cartella, valida per tutte le sedi in cui lavora.
    byMember: (memberId: string) => ["documents", "byMember", memberId] as const,
  },
  roles: {
    all: ["roles"] as const,
    byVenue: (venueId: string) => ["roles", "byVenue", venueId] as const,
    /** I ruoli di tutte le sedi dell'azienda. `scope` è `venuesKey`. */
    byOwner: (scope: string) => ["roles", "byOwner", scope] as const,
    byStaffMember: (staffMemberId: string) =>
      ["roles", "byStaffMember", staffMemberId] as const,
  },
  staff: {
    all: ["staff"] as const,
    byVenue: (venueId: string) => ["staff", "byVenue", venueId] as const,
    /**
     * Le persone del titolare, attraverso le sedi. Sotto il prefisso `staff.all`,
     * quindi ogni invalidazione dell'organico già esistente la copre.
     */
    people: (workspaceId: string) => ["staff", "people", workspaceId] as const,
    /** La scheda di una persona, con tutte le sue sedi. */
    person: (personId: string) => ["staff", "person", personId] as const,
    invites: (waiterId: string) => ["staff", "invites", waiterId] as const,
    employers: (waiterId: string) => ["staff", "employers", waiterId] as const,
    /**
     * Le ore di un mese, per **azienda** e non per sede: chi lavora in due sedi
     * dello stesso titolare ha una sola busta paga (20260913110100).
     *
     * `workspaceId` è sia il confine della RPC sia quello della cache. Sotto
     * `staff.all`, quindi già invalidata da `invalidateAfterShiftWrite` e da
     * `useSetAssignmentPresence`.
     */
    ownerHours: (workspaceId: string, month: string) =>
      ["staff", "ownerHours", workspaceId, month] as const,
  },
  assignments: {
    all: ["assignments"] as const,
    byShift: (shiftId: string) => ["assignments", "byShift", shiftId] as const,
    byStaff: (staffMemberId: string) =>
      ["assignments", "byStaff", staffMemberId] as const,
    workHistory: (waiterId: string) =>
      ["assignments", "workHistory", waiterId] as const,
    workHistoryTotals: (waiterId: string) =>
      ["assignments", "workHistoryTotals", waiterId] as const,
    workHistoryRange: (waiterId: string, from: string, to: string) =>
      ["assignments", "workHistoryRange", waiterId, from, to] as const,
    workTotals: (waiterId: string, from: string, to: string) =>
      ["assignments", "workTotals", waiterId, from, to] as const,
    /**
     * Statistiche e turni recenti della **persona**, su tutte le sedi del
     * titolare: sono i numeri della sua busta paga, non di un suo indirizzo.
     */
    personPerformance: (personId: string) =>
      ["assignments", "personPerformance", personId] as const,
    personWorked: (personId: string, limit: number) =>
      ["assignments", "personWorked", personId, limit] as const,
    roleReqs: (shiftId: string) => ["assignments", "roleReqs", shiftId] as const,
    /**
     * I turni attivi di una persona in un intervallo, su tutte le sedi: i
     * conflitti con un'assenza. Sotto `assignments` perché è lì che cambiano.
     */
    personRange: (personId: string, from: string, to: string) =>
      ["assignments", "personRange", personId, from, to] as const,
    /** Chi lavora oggi, in tutte le sedi: `scope` è `venuesKey`, come i turni. */
    today: (scope: string) => ["assignments", "today", scope] as const,
    todayAll: ["assignments", "today"] as const,
    mineUpcoming: (waiterId: string) =>
      ["assignments", "mineUpcoming", waiterId] as const,
    mineForShift: (shiftId: string, waiterId: string) =>
      ["assignments", "mineForShift", shiftId, waiterId] as const,
  },
  /**
   * Il planning che il professionista vede delle sedi in cui è in organico.
   *
   * Nessun id utente nella chiave: la RPC parte da `auth.uid()`, e l'uscita
   * svuota la cache (`queryClient.clear()` su `SIGNED_OUT` in `auth.tsx`).
   * L'intervallo invece c'è, perché scorrendo le settimane se ne tiene più d'uno
   * in cache — stessa ragione di `shifts.range`.
   */
  planning: {
    all: ["planning"] as const,
    range: (from: string, to: string) => ["planning", "range", from, to] as const,
  },
  waiterCard: (waiterId: string) => ["waiterCard", waiterId] as const,
  chat: {
    all: ["chat"] as const,
    // Chiavi "larghe" usate da RealtimeSync: invalidano lista e badge senza
    // toccare le pagine del thread aperto (mantenute dal canale per-thread).
    conversationsAll: ["chat", "conversations"] as const,
    conversations: (userId: string) => ["chat", "conversations", userId] as const,
    conversation: (conversationId: string) =>
      ["chat", "conversations", "detail", conversationId] as const,
    messages: (conversationId: string) =>
      ["chat", "messages", conversationId] as const,
    unreadAll: ["chat", "unread"] as const,
    unread: (userId: string) => ["chat", "unread", userId] as const,
    /** Rubrica: chi posso raggiungere, in tutte le aziende in cui sono attivo. */
    contacts: (userId: string) => ["chat", "contacts", userId] as const,
  },
  /**
   * Richieste di cambio turno.
   *
   * `byId` e non una lista: la card vive dentro il thread di chat e ogni
   * messaggio sa già quale richiesta porta. `pendingFor` risponde invece alla
   * domanda delle schermate del turno — «questa persona ha chiesto il cambio?».
   */
  changeRequests: {
    all: ["changeRequests"] as const,
    byId: (requestId: string) => ["changeRequests", "byId", requestId] as const,
    pendingFor: (assignmentId: string) =>
      ["changeRequests", "pendingFor", assignmentId] as const,
    byShift: (shiftId: string) =>
      ["changeRequests", "byShift", shiftId] as const,
  },
  /**
   * Ferie, permessi e malattia.
   *
   * Tutto sotto un prefisso solo: ogni scrittura cambia insieme la lista della
   * persona, quella di chi la gestisce e la card in chat, e sono poche righe.
   * `employers` è qui e non sotto `staff` perché serve solo al form.
   */
  absences: {
    all: ["absences"] as const,
    byId: (absenceId: string) => ["absences", "byId", absenceId] as const,
    mine: (waiterId: string) => ["absences", "mine", waiterId] as const,
    current: (waiterId: string) =>
      ["absences", "current", waiterId] as const,
    employers: (waiterId: string) =>
      ["absences", "employers", waiterId] as const,
    byPerson: (personId: string) =>
      ["absences", "byPerson", personId] as const,
    toHandle: (workspaceId: string) =>
      ["absences", "toHandle", workspaceId] as const,
    /** Tutta l'azienda, per la pagina Assenze. */
    company: (workspaceId: string) =>
      ["absences", "company", workspaceId] as const,
    /** Il riepilogo del mese per il commercialista (pagina Ore). */
    summary: (workspaceId: string, month: string) =>
      ["absences", "summary", workspaceId, month] as const,
    /** Chi non c'è, senza il perché: la fonte del planning. */
    availability: (from: string, to: string) =>
      ["absences", "availability", from, to] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (userId: string) => ["notifications", "list", userId] as const,
    unread: (userId: string) => ["notifications", "unread", userId] as const,
  },
} as const;
