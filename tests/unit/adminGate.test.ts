import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "../../web/src/admin/AdminApp";
const { status, globalRead } = vi.hoisted(() => ({ status: vi.fn(), globalRead: vi.fn() }));
vi.mock('@/features/admin/hooks', () => ({ useAdminAccess: status, useAdminRead: globalRead }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'founder' }, access_token: 'fixture' }, signOut: vi.fn() }) }));
vi.mock('@/features/admin/api', () => ({ getAdminOverview: vi.fn(), listAdminWorkspaces: vi.fn(), getAdminWorkspace: vi.fn(), listAdminAccounts: vi.fn(), getAdminAccount: vi.fn(), listAdminMfaFactors: vi.fn(), enrollAdminMfa: vi.fn(), cancelAdminMfaEnrollment: vi.fn(), verifyAdminMfa: vi.fn() }));
function render() {
  const client = new QueryClient();
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/amministrazione'] }, createElement(AdminApp))));
}
describe('Gate fondatore prima delle query globali', () => {
  beforeEach(() => { status.mockReset(); globalRead.mockReset(); });
  it('attende il server senza caricare dati globali', () => {
    status.mockReturnValue({ isPending: true });
    expect(render()).toContain('Verifica accesso');
    expect(globalRead).not.toHaveBeenCalled();
  });
  it('nega gli account fuori allowlist', () => {
    status.mockReturnValue({ data: { eligible: false, can_access: false } });
    expect(render()).toContain('Area riservata');
    expect(globalRead).not.toHaveBeenCalled();
  });
  it('mostra il challenge MFA senza caricare dati globali', () => {
    status.mockReturnValue({ data: { eligible: true, can_access: false } });
    expect(render()).toContain('Verifica del fondatore');
    expect(globalRead).not.toHaveBeenCalled();
  });
  it('nasconde risultati precedenti durante una nuova verifica di sessione o errore', () => {
    status.mockReturnValue({ isPending: true, data: { eligible: true, can_access: true } });
    render();
    expect(globalRead).not.toHaveBeenCalled();
    status.mockReturnValue({ isError: true, data: { eligible: true, can_access: true }, error: new Error('admin_not_allowed') });
    expect(render()).toContain('Accesso da verificare');
    expect(globalRead).not.toHaveBeenCalled();
  });
  it('il controllo periodico non smonta le pagine già autorizzate', () => {
    status.mockReturnValue({ isFetching: true, data: { eligible: true, can_access: true } });
    globalRead.mockReturnValue({ isPending: true });
    expect(render()).toContain('Verifica accesso in corso');
    expect(globalRead).toHaveBeenCalledOnce();
  });
  it('carica la panoramica soltanto dopo la verifica completa', () => {
    status.mockReturnValue({ data: { eligible: true, can_access: true } });
    globalRead.mockReturnValue({ isPending: true });
    expect(render()).toContain('KlokShift · Fondatore');
    expect(globalRead).toHaveBeenCalledOnce();
  });
});
