import { useMutation, useQuery } from "@tanstack/react-query";

export type HelpdeskTicket = {
  ticket_id: string;
  customer_name: string;
  ticket: string;
};
export type HelpdeskResult = {
  ticket_id: string;
  customer_name: string;
  category: string;
  priority: string;
  language: string;
  case_summary: string;
  resolution_type: string;
  recommended_action: string;
  requires_human: boolean;
  resolution_reason: string;
  response: string;
};
async function request<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api/helpdesk/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? undefined : {"Content-Type": "application/json"},
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed. Please retry.");
  return result;
}
export const getGetHelpdeskTicketsQueryKey = () => ["helpdesk", "tickets"];
export function useGetHelpdeskTickets(options: {
  query: { enabled: boolean; queryKey: readonly unknown[] };
}) {
  return useQuery({
    ...options.query,
    queryFn: () => request<HelpdeskTicket[]>("tickets"),
    retry: false,
  });
}
export function useCreateHelpdeskTicket() {
  return useMutation({
    mutationFn: ({data}: {data: {ticket: string; customer_name?: string}}) =>
      request<HelpdeskTicket>("tickets", data),
  });
}
export function useProcessHelpdeskTicket() {
  return useMutation({
    mutationFn: ({data}: {data: HelpdeskTicket}) =>
      request<HelpdeskResult>("process", data),
  });
}
