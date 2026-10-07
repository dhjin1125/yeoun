alter table public.dream_analytics_events
  drop constraint if exists dream_analytics_events_event_name_check;

alter table public.dream_analytics_events
  add constraint dream_analytics_events_event_name_check check (event_name in (
    'input_started', 'analysis_submitted', 'clarification_answered', 'clarification_skipped',
    'free_result_viewed', 'paywall_viewed', 'preview_card_clicked', 'paywall_clicked',
    'checkout_started', 'payment_succeeded', 'paid_result_viewed', 'followup_used',
    'share_created', 'deep_reading_viewed', 'conversation_message_sent',
    'conversation_reply_viewed', 'credits_exhausted', 'followup_pack_purchased',
    'safety_route_shown', 'answer_rated'
  ));

comment on constraint dream_analytics_events_event_name_check on public.dream_analytics_events is
  'Allowlisted funnel events. Event context must never contain dream, question, answer, email, or OAuth identity text.';
