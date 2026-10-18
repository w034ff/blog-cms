'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isAdmin } from '@/lib/dal';
import { addInvite, removeInvite, saveAuthorAccessMode } from '@/lib/author-access';
import { isAuthorAccessMode } from '@/lib/author-access-rules';
import { suspendUser, unsuspendUser } from '@/lib/admin-users';

// User administration Server Actions (/admin/users, docs/multi-author-requirements.md §9.5).
// Every action verifies admin rights first and answers in the shape of app/actions/settings.ts.

export type UserActionState = { error?: string; at?: number };

const ADMIN_ONLY: UserActionState = { error: '利用者の管理は管理者だけが行えます。' };
const CANNOT_SUSPEND_ADMIN: UserActionState = { error: '管理者は停止できません。' };
const INVALID_EMAIL: UserActionState = { error: 'メールアドレスの形ではありません。' };
const DUPLICATE_INVITE: UserActionState = { error: 'このメールアドレスは招待済みです。' };

const emailSchema = z.string().email();

function resolveFormData(prev: unknown, formData: unknown): FormData {
  if (formData instanceof FormData) return formData;
  if (prev instanceof FormData) return prev;
  return new FormData();
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export async function saveAuthorAccessModeAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const fd = resolveFormData(_prev, formData);
  const mode = field(fd, 'mode');
  if (!isAuthorAccessMode(mode)) return { error: '不正な方針です。' };
  saveAuthorAccessMode(mode);
  revalidatePath('/admin/users');
  return { at: Date.now() };
}

export async function addInviteAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const fd = resolveFormData(_prev, formData);
  const rawEmail = field(fd, 'email').trim();
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return INVALID_EMAIL;
  const result = addInvite(parsed.data);
  if (result === 'duplicate') return DUPLICATE_INVITE;
  revalidatePath('/admin/users');
  return { at: Date.now() };
}

export async function removeInviteAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const fd = resolveFormData(_prev, formData);
  const email = field(fd, 'email');
  removeInvite(email);
  revalidatePath('/admin/users');
  return { at: Date.now() };
}

export async function suspendUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const fd = resolveFormData(_prev, formData);
  const id = Number(field(fd, 'id'));
  if (!Number.isInteger(id)) return { error: '利用者が指定されていません。' };
  const success = suspendUser(id);
  if (!success) return CANNOT_SUSPEND_ADMIN;
  revalidatePath('/admin/users');
  revalidatePath('/', 'layout');
  return { at: Date.now() };
}

export async function unsuspendUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  if (!(await isAdmin())) return ADMIN_ONLY;
  const fd = resolveFormData(_prev, formData);
  const id = Number(field(fd, 'id'));
  if (!Number.isInteger(id)) return { error: '利用者が指定されていません。' };
  unsuspendUser(id);
  revalidatePath('/admin/users');
  revalidatePath('/', 'layout');
  return { at: Date.now() };
}
