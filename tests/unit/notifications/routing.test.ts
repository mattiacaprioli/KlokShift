import { describe, expect, it } from "vitest";
import { routeForNotification } from "@/features/notifications/routing";
import { Constants } from "@/types/database";

const TYPES = Constants.public.Enums.notification_type;

describe("dove atterra una notifica", () => {
  it("è totale sui tipi, per entrambe le viste", () => {
    for (const role of ["waiter", "manager"] as const) {
      for (const type of TYPES) {
        expect(() => routeForNotification(role, type, "id")).not.toThrow();
        expect(() => routeForNotification(role, type, null)).not.toThrow();
      }
    }
  });

  it("promemoria dell'archivio: home della gestione nell'app, mai un turno", () => {
    // related_id è l'azienda: il ramo finale la aprirebbe come turno.
    expect(routeForNotification("manager", "archive_reminder", "w1")).toBe("/(manager)/(tabs)");
    expect(routeForNotification("waiter", "archive_reminder", "w1")).toBeNull();
  });

  it("professionista: turni sul turno, messaggi ed esiti nel thread", () => {
    expect(routeForNotification("waiter", "shift_assigned", "s1")).toBe("/(waiter)/shift/s1");
    expect(routeForNotification("waiter", "new_message", "c1")).toBe("/(waiter)/chat/c1");
    expect(routeForNotification("waiter", "absence_response", "c1")).toBe("/(waiter)/chat/c1");
    expect(routeForNotification("waiter", "staff_invite", "x")).toBe("/(waiter)/inviti");
    // related_id è una riga di organico, non un turno.
    expect(routeForNotification("waiter", "staff_linked", "vm1")).toBe("/(waiter)/(tabs)");
  });

  it("professionista: niente da aprire sulle rimozioni", () => {
    for (const type of ["staff_removed", "shift_unassigned"] as const) {
      expect(routeForNotification("waiter", type, "s1")).toBeNull();
    }
  });

  it("promemoria di timbratura: dove c'è il pulsante per timbrare", () => {
    expect(routeForNotification("waiter", "clock_reminder", "s1")).toBe("/(waiter)/shift/s1");
    // Fuori turno: nessun turno da aprire, l'uscita sta in Home.
    expect(routeForNotification("waiter", "clock_reminder", null)).toBe("/(waiter)/(tabs)");
    // Chi gestisce e lavora timbra dalla sua Home.
    expect(routeForNotification("manager", "clock_reminder", "s1")).toBe("/(manager)/(tabs)");
  });

  it("professionista: il turno annullato si apre, il dettaglio dice «Annullato»", () => {
    // Le assegnazioni restano e il turno resta leggibile (my_shift_ids).
    expect(routeForNotification("waiter", "shift_cancelled", "s1")).toBe("/(waiter)/shift/s1");
  });

  it("gestione: assenze nel thread col titolare, oppure alla pagina Assenze", () => {
    expect(routeForNotification("manager", "absence_request", "c1")).toBe("/(manager)/chat/c1");
    expect(routeForNotification("manager", "absence_request", null)).toBe("/(manager)/assenze");
    expect(routeForNotification("manager", "shift_change_request", "c1")).toBe("/(manager)/chat/c1");
    expect(routeForNotification("manager", "team_linked", "v1")).toBe("/(manager)/(tabs)");
    expect(routeForNotification("manager", "team_removed", "v1")).toBeNull();
    expect(routeForNotification("manager", "shift_declined", "s1")).toBe("/(manager)/shift/s1");
  });
});
