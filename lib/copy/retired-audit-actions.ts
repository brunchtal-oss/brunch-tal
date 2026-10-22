// Audit actions that only old migration files still write: no live function
// records them any more. Read by the tests only (audit-actions.test.ts counts
// them as decided; supabase/tests/audit-retired-actions.test.ts checks that
// no live function body writes one).
export const RETIRED_AUDIT_ACTIONS: readonly string[] = [
  // Dropped or rewritten functions (topics, the single shopping item,
  // one-time migrations).
  "admin_add_note_topic",
  "admin_rename_note_topic",
  "admin_delete_note_topic",
  "admin_set_note_topic_order",
  "admin_add_shopping_item",
  "refresh_returned_entitlements",
  "migrate_identity_match",
  // Story 5.20 (fix 6): recorded but never listed, so no longer written.
  // The work sheet.
  "admin_add_prep_day",
  "admin_remove_prep_day",
  "admin_move_prep_day",
  "admin_add_work_dish",
  "admin_update_work_dish",
  "admin_delete_work_dish",
  "admin_set_work_dish_order",
  "admin_add_work_task",
  "admin_update_work_task",
  "admin_delete_work_task",
  "admin_set_work_task_done",
  "admin_set_work_task_order",
  "admin_add_shopping_items",
  "admin_update_shopping_item",
  "admin_delete_shopping_item",
  "admin_set_shopping_item_bought",
  "admin_set_shopping_item_order",
  // Notes.
  "admin_add_note",
  "admin_update_note",
  "admin_delete_note",
  "admin_set_note_archived",
  "admin_set_note_done",
  "admin_set_note_pinned",
  "admin_set_note_order",
  // Drafts and images.
  "admin_set_content_draft",
  "admin_create_media",
  "admin_begin_media_publish",
  "admin_finish_media_publish",
  "media_hidden",
  "admin_set_event_image",
  "admin_set_concept_image",
  // The same approval as approve_payment (AD-10).
  "admin_approve_payment",
  // Technical steps.
  "admin_begin_email_change",
  "admin_finish_anonymize_customer",
  "join_begin",
  // Masked, nothing to check.
  "set_booking_guest_details",
  // Calls bind_purchase, which is shown.
  "claim_join",
]
