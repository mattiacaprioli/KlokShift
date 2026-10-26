describe("Login", () => {
  beforeEach(() => {
    cy.visit("/#/login");
  });
  it("mostra il form di accesso", () => {
    // cy.get = selettore CSS. I data-cy esistono solo per i test:
    // non cambiano se cambia lo stile o il testo della pagina.
    cy.get('[data-cy="login-email"]').should("be.visible");
    cy.get('[data-cy="login-password"]').should("be.visible");
    cy.get('[data-cy="login-submit"]')
      .should("be.visible")
      .and("contain.text", "Accedi");
  });

  it("senza login rimanda al login", () => {
    cy.visit("/#/planning");

    cy.url().should("include", "/#/login");
  });

  it("l'occhio mostra la password senza perdere il campo", () => {
    // Prima del click la password è nascosta
    cy.get('[data-cy="login-password"]').should(
      "have.attr",
      "type",
      "password",
    );

    // L'occhio non ha un data-cy: lo troviamo per la sua aria-label,
    // che è anche quello che "legge" uno screen reader
    cy.get('[aria-label="Mostra la password"]').click();

    // Dopo il click il campo è ancora lì (stesso data-cy), ma in chiaro
    cy.get('[data-cy="login-password"]').should("have.attr", "type", "text");
  });

  it("chiede l'email prima del recupero password", () => {
    // Il campo email è vuoto: il beforeEach ha appena aperto la pagina.
    // Il pulsante lo cerchiamo per testo: è quello che l'utente legge e clicca.
    cy.contains("button", "Password dimenticata?").click();

    // Il messaggio è la cosa da verificare, quindi lo cerchiamo per testo.
    cy.contains(
      "Scrivi la tua email qui sopra, poi richiedi il recupero.",
    ).should("be.visible");
  });

  it("rifiuta un'email senza chiocciola per il recupero", () => {
    cy.get('[data-cy="login-email"]')
      .type("mario")
      .should("have.value", "mario");

    cy.contains("button", "Password dimenticata?").click();

    cy.contains(
      "Scrivi la tua email qui sopra, poi richiedi il recupero.",
    ).should("be.visible");
  });
});
