import { request } from './client';
import type {
  CreateInvitationRequest,
  CreateInvitationResponse,
  InvitationInfoResponse,
  AcceptInvitationResponse,
} from '@/types/api';

// ── 邀请 ──

export const invitationApi = {
  create: (projectId: string, data: CreateInvitationRequest) =>
    request<CreateInvitationResponse>(`/projects/${projectId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getInfo: (token: string) =>
    request<InvitationInfoResponse>(`/invitations/${token}`),

  accept: (token: string) =>
    request<AcceptInvitationResponse>(`/invitations/${token}/accept`, {
      method: 'POST',
    }),
};
