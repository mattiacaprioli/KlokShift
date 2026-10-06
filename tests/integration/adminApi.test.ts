import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminAccess, getAdminOverview, getAdminWorkspace, getAdminAccount, listAdminWorkspaces, listAdminAccounts, enrollAdminMfa, verifyAdminMfa, listAdminMfaFactors } from "@/features/admin/api";
import { workspaceSchema } from "@/features/admin/types";
import { qk } from "@/lib/queryKeys";
import { createTestQueryClient } from "../helpers/async";
const { rpc, mfa } = vi.hoisted(() => ({ rpc: vi.fn(), mfa: { enroll: vi.fn(), listFactors: vi.fn(), challengeAndVerify: vi.fn(), unenroll: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc, auth: { mfa } } }));
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const date = "2026-10-06T12:00:00+00:00";
const empty = { total: 0, limit: 25, offset: 0, items: [] };
const workspace = {
  id, name: 'Fixture', created_at: date, deleted_at: null, classification: 'unclassified', state: 'migration_pending',
  access: { workspace_id: id, state: 'migration_pending', source: null, plan: null, operational_from: null, operational_until: null, archive_until: null, attendance_until: null, can_operate: false, can_read: true, can_complete_attendance: false, limits: { people: null, venues: null }, usage: { people: 2, venues: 1 } },
  open_venues: 1, closed_venues: 0, active_members: 3, invited_members: 0, left_members: 0, unlinked_members: 1, managers: 1, current_placements: 2,
  document_files: 0, document_known_bytes: 0, document_unknown_sizes: 0, flags: []
};
const account = { id, full_name: 'Persona', email: 'person@example.test', created_at: date, email_confirmed_at: date, last_sign_in_at: null, deleted_at: null, is_anonymous: false, status: 'confirmed', classification: 'unclassified', active_memberships: 0, invited_memberships: 0, left_memberships: 0 };
function response(data: unknown) { rpc.mockResolvedValue({ data, error: null }); }
describe('Amministrazione: dati verificati e confini della cache', () => {
  beforeEach(() => { rpc.mockReset(); Object.values(mfa).forEach((fn) => fn.mockReset()); });
  it('rifiuta status incompleto e accesso senza eleggibilità', async () => {
    response(null);
    await expect(getAdminAccess()).rejects.toThrow('admin_response_invalid');
    response({ eligible: false, can_access: true });
    await expect(getAdminAccess()).rejects.toThrow('admin_response_invalid');
    response({ eligible: true, can_access: false });
    await expect(getAdminAccess()).resolves.toEqual({ eligible: true, can_access: false });
  });
  it('propaga una revoca server senza conservare un riepilogo', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin_not_allowed' } });
    await expect(getAdminOverview()).rejects.toThrow('admin_not_allowed');
  });
  it('pagina aziende sul server e non assegna diritti alla migrazione', async () => {
    response({ ...empty, total: 1, items: [workspace], generated_at: date });
    const result = await listAdminWorkspaces({ query: 'referente', state: 'migration_pending', plan: 'all', classification: 'unclassified', offset: 0 });
    expect(rpc).toHaveBeenCalledWith('admin_list_workspaces', { p_query: 'referente', p_state: 'migration_pending', p_plan: 'all', p_classification: 'unclassified', p_limit: 25, p_offset: 0 });
    expect(result.items[0].access?.plan).toBeNull();
    expect(result.items[0].access?.can_operate).toBe(false);
  });
  it('rifiuta pagine incoerenti e dimensioni non numeriche', async () => {
    response({ ...empty, offset: 25, generated_at: date });
    await expect(listAdminAccounts({ query: '', status: 'all', classification: 'all', offset: 0 })).rejects.toThrow('admin_response_invalid');
    expect(workspaceSchema.safeParse({ ...workspace, document_known_bytes: '1024' }).success).toBe(false);
    expect(workspaceSchema.safeParse({ ...workspace, access: { ...workspace.access, workspace_id: other } }).success).toBe(false);
  });
  it('non accetta dettagli di un altro account o di un’altra azienda', async () => {
    response({ generated_at: date, account, memberships: empty, classification_reason: null });
    await expect(getAdminAccount(other, 0)).rejects.toThrow('admin_response_invalid');
    response({ generated_at: date, workspace, members: empty, venues: empty, periods: empty, activity: { last_shift_created_at: null, last_clock_in_at: null, last_manager_sign_in_at: null }, classification_reason: null, finance: null, costs: null });
    await expect(getAdminWorkspace(other, { members: 0, venues: 0, periods: 0 })).rejects.toThrow('admin_response_invalid');
  });
  it('scarta campi HR e non inventa dati economici', async () => {
    response({ ...empty, total: 1, items: [{ ...account, hr: { iban: 'segreto' } }], generated_at: date });
    const result = await listAdminAccounts({ query: '', status: 'all', classification: 'all', offset: 0 });
    expect(result.items[0]).not.toHaveProperty('hr');
    response({ generated_at: date });
    await expect(getAdminOverview()).rejects.toThrow('admin_response_invalid');
  });
  it('separa identità, sessioni e dati cliente nelle chiavi', () => {
    const client = createTestQueryClient();
    const key = qk.admin.data(id, 'overview');
    client.setQueryData(key, { private: true });
    expect(client.getQueryData(qk.admin.data(other, 'overview'))).toBeUndefined();
    expect(qk.admin.access(id, 'one')).not.toEqual(qk.admin.access(id, 'two'));
    client.removeQueries({ queryKey: qk.workspaceAccess.all });
    expect(client.getQueryData(key)).toEqual({ private: true });
    client.clear();
  });
  it('configura TOTP solo quando richiesto e verifica con Auth', async () => {
    const svg='<svg fill="#000" />';
    mfa.enroll.mockResolvedValue({ data: { id, totp: { qr_code: `data:image/svg+xml;utf-8,${svg}`, secret: 'fixture' } }, error: null });
    const enrollment=await enrollAdminMfa();
    expect(enrollment.secret).toBe('fixture');
    expect(new URL(enrollment.qr).hash).toBe('');
    expect(decodeURIComponent(enrollment.qr.split(',')[1])).toBe(svg);
    mfa.challengeAndVerify.mockResolvedValue({ error: null });
    await verifyAdminMfa(id, '123456');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: id, code: '123456' });
  });
  it('rifiuta codice incompleto e challenge fallito', async () => {
    await expect(verifyAdminMfa(id, '12')).rejects.toThrow('admin_mfa_verification_failed');
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
    mfa.challengeAndVerify.mockResolvedValue({ error: { message: 'Auth denied' } });
    await expect(verifyAdminMfa(id, '123456')).rejects.toThrow('admin_mfa_verification_failed');
  });
  it('separa fattori verificati da configurazioni da riprendere', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id, status: 'verified' }], all: [{ id, factor_type: 'totp', status: 'verified' }, { id: other, factor_type: 'totp', status: 'unverified' }] }, error: null });
    await expect(listAdminMfaFactors()).resolves.toEqual({ verified: [{ id, name: 'App di autenticazione' }], pending: [{ id: other, name: 'App di autenticazione' }] });
  });
});
