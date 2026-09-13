/**
 * Central query-key factory. Always build keys through here so invalidation
 * stays consistent across features.
 */
export const qk = {
  venues: {
    all: ["venues"] as const,
    /** Le sedi aperte del titolare. Una lista: un account può averne più di una. */
    mine: (ownerId: string) => ["venues", "mine", ownerId] as const,
    closed: (ownerId: string) => ["venues", "closed", ownerId] as const,
  },
  profile: {
    mine: (userId: string) => ["profile", "mine", userId] as const,
    byId: (userId: string) => ["profile", "byId", userId] as const,
  },
  experiences: {
    byWaiter: (waiterId: string) =>
      ["experiences", "byWaiter", waiterId] as const,
    detail: (id: string) => ["experiences", "detail", id] as const,
  },
  shifts: {
    all: ["shifts"] as const,
    byVenue: (venueId: string) => ["shifts", "byVenue", venueId] as const,
    range: (venueId: string, from: string, to: string) =>
      ["shifts", "range", venueId, from, to] as const,
    // Prefisso: invalida ogni intervallo già in cache per quel locale (la vista
    // calendario ne tiene più di uno mentre si naviga tra le settimane).
    rangeAll: (venueId: string) => ["shifts", "range", venueId] as const,
    /**
     * I turni della settimana nelle **altre** sedi del titolare: servono alle
     * soglie 40/48h, che sono della persona e non del locale.
     */
    elsewhereRange: (venueId: string, from: string, to: string) =>
      ["shifts", "elsewhereRange", venueId, from, to] as const,
    /** Prefisso: un turno che cambia può alterare il carico visto altrove. */
    elsewhereAll: ["shifts", "elsewhereRange"] as const,
    past: (venueId: string) => ["shifts", "past", venueId] as const,
    pastCount: (venueId: string) => ["shifts", "pastCount", venueId] as const,
    detail: (id: string) => ["shifts", "detail", id] as const,
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
    // Per persona e non per scheda: chi lavora in due sedi dello stesso titolare
    // ha una sola cartella di documenti (20260913100100).
    byPerson: (personId: string) =>
      ["documents", "byPerson", personId] as const,
    /** Le cartelle del professionista: una per datore di lavoro. */
    scopes: (waiterId: string) => ["documents", "scopes", waiterId] as const,
  },
  roles: {
    all: ["roles"] as const,
    byVenue: (venueId: string) => ["roles", "byVenue", venueId] as const,
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
    people: (ownerId: string) => ["staff", "people", ownerId] as const,
    /** La scheda di una persona, con tutte le sue sedi. */
    person: (personId: string) => ["staff", "person", personId] as const,
    invites: (waiterId: string) => ["staff", "invites", waiterId] as const,
    employers: (waiterId: string) => ["staff", "employers", waiterId] as const,
    /**
     * Le ore di un mese, per **azienda** e non per sede: chi lavora in due sedi
     * dello stesso titolare ha una sola busta paga (20260913110100).
     *
     * `ownerId` è solo la chiave — la RPC usa `auth.uid()`. Sotto `staff.all`,
     * quindi già invalidata da `invalidateAfterShiftWrite` e da
     * `useSetAssignmentPresence`.
     */
    ownerHours: (ownerId: string, month: string) =>
      ["staff", "ownerHours", ownerId, month] as const,
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
    /**
     * Statistiche e turni recenti della **persona**, su tutte le sedi del
     * titolare: sono i numeri della sua busta paga, non di un suo indirizzo.
     */
    personPerformance: (personId: string) =>
      ["assignments", "personPerformance", personId] as const,
    personWorked: (personId: string, limit: number) =>
      ["assignments", "personWorked", personId, limit] as const,
    roleReqs: (shiftId: string) => ["assignments", "roleReqs", shiftId] as const,
    today: (venueId: string) => ["assignments", "today", venueId] as const,
    mineUpcoming: (waiterId: string) =>
      ["assignments", "mineUpcoming", waiterId] as const,
    mineForShift: (shiftId: string, waiterId: string) =>
      ["assignments", "mineForShift", shiftId, waiterId] as const,
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
  },
  notifications: {
    all: ["notifications"] as const,
    list: (userId: string) => ["notifications", "list", userId] as const,
    unread: (userId: string) => ["notifications", "unread", userId] as const,
  },
} as const;
