import { apiRequest } from '@/services/api'

export type LeadDeliveryStatus = 'pending' | 'sent' | 'failed'
export type LeadAggregateStatus = 'not_sent' | 'pending' | 'sent' | 'partial' | 'failed'

export interface LeadDelivery {
  id: number
  integration_id: number
  integration_name: string | null
  source: string
  status: LeadDeliveryStatus
  attempt_count: number
  last_attempt_at: string | null
  next_retry_at: string | null
  error_message: string | null
  created_at: string | null
}

export interface LeadFormSubmission {
  id: number
  form_id: number
  form_name: string | null
  data: Record<string, string>
  created_at: string | null
}

export interface LeadStatusResponse {
  has_integrations: boolean
  status: LeadAggregateStatus
  deliveries: LeadDelivery[]
  submissions: LeadFormSubmission[]
}

export const leadsApi = {
  getStatus: (conversationId: number) =>
    apiRequest<LeadStatusResponse>(`/conversations/${conversationId}/leads`),

  sendNow: (conversationId: number, formId?: number | null) =>
    apiRequest<{ success: boolean }>(`/conversations/${conversationId}/leads`, {
      method: 'POST',
      body: JSON.stringify({ form_id: formId ?? null }),
    }),

  resendDelivery: (conversationId: number, deliveryId: number) =>
    apiRequest<LeadDelivery>(`/conversations/${conversationId}/leads/deliveries/${deliveryId}/resend`, {
      method: 'POST',
    }),
}
