describe("Login", () => {
  it("mostra il form di accesso", () => {
    cy.visit("/#/login");

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
    cy.visit("/#/login");

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
});
