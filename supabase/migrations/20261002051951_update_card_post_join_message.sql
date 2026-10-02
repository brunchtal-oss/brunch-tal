-- Story 2.2 phone test (user decision 2026-10-02, overrides the source §4
-- card wording): the post-join message of the punch card drops its first
-- sentence. Only the seeded default changes; a product Tal already edited
-- keeps her text. The button label stays. This is content, not code text.

update public.products
set post_join_message = 'כדאי לבחור כבר עכשיו את כל ארבעת התאריכים שנוחים לך ולהבטיח את מקומך.'
where type = 'card'
  and post_join_message = 'אוכל טוב וחברה נעימה מחכים לך. כדאי לבחור כבר עכשיו את כל ארבעת התאריכים שנוחים לך ולהבטיח את מקומך.';
