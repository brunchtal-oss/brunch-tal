export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activation_tokens: {
        Row: {
          bound_user_id: string | null
          claiming_at: string | null
          conflict_reason: string | null
          consumed_at: string | null
          created_at: string
          customer_id: string | null
          expires_at: string
          id: string
          identity_attempts: number
          input_hash: string | null
          payment_id: string | null
          pending_user_id: string | null
          purpose: string
          revoked_at: string | null
          state: string
          token_hash: string
        }
        Insert: {
          bound_user_id?: string | null
          claiming_at?: string | null
          conflict_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at: string
          id?: string
          identity_attempts?: number
          input_hash?: string | null
          payment_id?: string | null
          pending_user_id?: string | null
          purpose: string
          revoked_at?: string | null
          state?: string
          token_hash: string
        }
        Update: {
          bound_user_id?: string | null
          claiming_at?: string | null
          conflict_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at?: string
          id?: string
          identity_attempts?: number
          input_hash?: string | null
          payment_id?: string | null
          pending_user_id?: string | null
          purpose?: string
          revoked_at?: string | null
          state?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "activation_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activation_tokens_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_roles: {
        Row: {
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          after: Json
          before: Json
          created_at: string
          customer_id: string | null
          entity_id: string | null
          entity_type: string
          event_id: string | null
          id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind: string
          after?: Json
          before?: Json
          created_at?: string
          customer_id?: string | null
          entity_id?: string | null
          entity_type: string
          event_id?: string | null
          id?: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          after?: Json
          before?: Json
          created_at?: string
          customer_id?: string | null
          entity_id?: string | null
          entity_type?: string
          event_id?: string | null
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      babies: {
        Row: {
          birth_date: string
          created_at: string
          customer_id: string
          id: string
          name: string
        }
        Insert: {
          birth_date: string
          created_at?: string
          customer_id?: string
          id?: string
          name: string
        }
        Update: {
          birth_date?: string
          created_at?: string
          customer_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "babies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_allocations: {
        Row: {
          booking_id: string
          created_at: string
          credit_id: string | null
          entitlement_id: string | null
          id: string
          units: number
        }
        Insert: {
          booking_id: string
          created_at?: string
          credit_id?: string | null
          entitlement_id?: string | null
          id?: string
          units: number
        }
        Update: {
          booking_id?: string
          created_at?: string
          credit_id?: string | null
          entitlement_id?: string | null
          id?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_allocations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_allocations_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlement_balances"
            referencedColumns: ["entitlement_id"]
          },
          {
            foreignKeyName: "booking_allocations_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booked_by: string
          cancelled_at: string | null
          confirmed_at: string
          created_at: string
          customer_id: string | null
          event_id: string
          guest_details: string | null
          id: string
          party_size: number
          payment_id: string | null
          policy_snapshot: Json
          status: string
        }
        Insert: {
          booked_by: string
          cancelled_at?: string | null
          confirmed_at?: string
          created_at?: string
          customer_id?: string | null
          event_id: string
          guest_details?: string | null
          id?: string
          party_size: number
          payment_id?: string | null
          policy_snapshot: Json
          status?: string
        }
        Update: {
          booked_by?: string
          cancelled_at?: string | null
          confirmed_at?: string
          created_at?: string
          customer_id?: string | null
          event_id?: string
          guest_details?: string | null
          id?: string
          party_size?: number
          payment_id?: string | null
          policy_snapshot?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      business_settings: {
        Row: {
          admin_expiring_days: number
          cancel_window_hours: number
          credit_options_count: number
          customer_expiring_days: number
          default_capacity_couple: number
          default_capacity_regular: number
          default_prep_days: number[]
          default_session_end_time: string
          default_session_start_time: string
          default_validity_days: number
          duplicate_payment_window_days: number
          id: boolean
          inactivity_months: number
          last_places_threshold: number
          marketing_reminder_schedule: Json
          registration_close_days_before: number
          registration_close_local_time: string
          reminder_lead_hours: number
          updated_at: string
          version: number
        }
        Insert: {
          admin_expiring_days?: number
          cancel_window_hours?: number
          credit_options_count?: number
          customer_expiring_days?: number
          default_capacity_couple?: number
          default_capacity_regular?: number
          default_prep_days?: number[]
          default_session_end_time?: string
          default_session_start_time?: string
          default_validity_days?: number
          duplicate_payment_window_days?: number
          id?: boolean
          inactivity_months?: number
          last_places_threshold?: number
          marketing_reminder_schedule?: Json
          registration_close_days_before?: number
          registration_close_local_time?: string
          reminder_lead_hours?: number
          updated_at?: string
          version?: number
        }
        Update: {
          admin_expiring_days?: number
          cancel_window_hours?: number
          credit_options_count?: number
          customer_expiring_days?: number
          default_capacity_couple?: number
          default_capacity_regular?: number
          default_prep_days?: number[]
          default_session_end_time?: string
          default_session_start_time?: string
          default_validity_days?: number
          duplicate_payment_window_days?: number
          id?: boolean
          inactivity_months?: number
          last_places_threshold?: number
          marketing_reminder_schedule?: Json
          registration_close_days_before?: number
          registration_close_local_time?: string
          reminder_lead_hours?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      concepts: {
        Row: {
          archived_at: string | null
          created_at: string
          default_image_id: string | null
          default_kind: string
          description: string | null
          generic_paper_key: string | null
          id: string
          name: string
          sort_order: number
          theme_key: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          default_image_id?: string | null
          default_kind: string
          description?: string | null
          generic_paper_key?: string | null
          id?: string
          name: string
          sort_order?: number
          theme_key: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          default_image_id?: string | null
          default_kind?: string
          description?: string | null
          generic_paper_key?: string | null
          id?: string
          name?: string
          sort_order?: number
          theme_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "concepts_default_image_id_fkey"
            columns: ["default_image_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pages: {
        Row: {
          created_at: string
          draft_content: Json | null
          published_at: string | null
          published_content: Json | null
          published_version: number
          slug: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          draft_content?: Json | null
          published_at?: string | null
          published_content?: Json | null
          published_version?: number
          slug: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          draft_content?: Json | null
          published_at?: string | null
          published_content?: Json | null
          published_version?: number
          slug?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      content_sections: {
        Row: {
          created_at: string
          draft_content: Json | null
          hidden: boolean
          id: string
          key: string
          kind: string
          page_slug: string
          published_at: string | null
          published_content: Json | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          draft_content?: Json | null
          hidden?: boolean
          id?: string
          key: string
          kind: string
          page_slug: string
          published_at?: string | null
          published_content?: Json | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          draft_content?: Json | null
          hidden?: boolean
          id?: string
          key?: string
          kind?: string
          page_slug?: string
          published_at?: string | null
          published_content?: Json | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_sections_page_slug_fkey"
            columns: ["page_slug"]
            isOneToOne: false
            referencedRelation: "content_pages"
            referencedColumns: ["slug"]
          },
        ]
      }
      entitlement_movements: {
        Row: {
          action: string
          actor_id: string | null
          booking_id: string | null
          created_at: string
          entitlement_id: string
          id: string
          reason: string | null
          reverses_id: string | null
          units: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          booking_id?: string | null
          created_at?: string
          entitlement_id: string
          id?: string
          reason?: string | null
          reverses_id?: string | null
          units: number
        }
        Update: {
          action?: string
          actor_id?: string | null
          booking_id?: string | null
          created_at?: string
          entitlement_id?: string
          id?: string
          reason?: string | null
          reverses_id?: string | null
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_movements_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_movements_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlement_balances"
            referencedColumns: ["entitlement_id"]
          },
          {
            foreignKeyName: "entitlement_movements_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlement_movements_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: false
            referencedRelation: "entitlement_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          allowed_weekdays: number[] | null
          bound_at: string | null
          created_at: string
          customer_id: string | null
          eligibility_snapshot: Json
          eligible_event_kind: string
          expires_at: string | null
          expires_on: string
          id: string
          kind: string
          original_units: number
          payment_id: string
          pinned_event_id: string | null
          status: string
          valid_from: string
        }
        Insert: {
          allowed_weekdays?: number[] | null
          bound_at?: string | null
          created_at?: string
          customer_id?: string | null
          eligibility_snapshot: Json
          eligible_event_kind: string
          expires_at?: string | null
          expires_on: string
          id?: string
          kind: string
          original_units: number
          payment_id: string
          pinned_event_id?: string | null
          status?: string
          valid_from: string
        }
        Update: {
          allowed_weekdays?: number[] | null
          bound_at?: string | null
          created_at?: string
          customer_id?: string | null
          eligibility_snapshot?: Json
          eligible_event_kind?: string
          expires_at?: string | null
          expires_on?: string
          id?: string
          kind?: string
          original_units?: number
          payment_id?: string
          pinned_event_id?: string | null
          status?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_pinned_event_id_fkey"
            columns: ["pinned_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity_adults: number
          concept_id: string
          created_at: string
          description: string | null
          display_price_agorot: number | null
          ends_at: string
          id: string
          image_id: string | null
          kind: string
          registration_close_overridden: boolean
          registration_closes_at: string
          revision: number
          starts_at: string
          status: string
          waitlist_cycle: number
        }
        Insert: {
          capacity_adults: number
          concept_id: string
          created_at?: string
          description?: string | null
          display_price_agorot?: number | null
          ends_at: string
          id?: string
          image_id?: string | null
          kind: string
          registration_close_overridden?: boolean
          registration_closes_at: string
          revision?: number
          starts_at: string
          status?: string
          waitlist_cycle?: number
        }
        Update: {
          capacity_adults?: number
          concept_id?: string
          created_at?: string
          description?: string | null
          display_price_agorot?: number | null
          ends_at?: string
          id?: string
          image_id?: string | null
          kind?: string
          registration_close_overridden?: boolean
          registration_closes_at?: string
          revision?: number
          starts_at?: string
          status?: string
          waitlist_cycle?: number
        }
        Relationships: [
          {
            foreignKeyName: "events_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt_text: string | null
          created_at: string
          created_by: string | null
          focus_x: number
          focus_y: number
          id: string
          public_path: string
          publish_started_at: string | null
          publish_state: string
          published_at: string | null
          storage_path: string
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          created_by?: string | null
          focus_x?: number
          focus_y?: number
          id: string
          public_path: string
          publish_started_at?: string | null
          publish_state?: string
          published_at?: string | null
          storage_path: string
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          created_by?: string | null
          focus_x?: number
          focus_y?: number
          id?: string
          public_path?: string
          publish_started_at?: string | null
          publish_state?: string
          published_at?: string | null
          storage_path?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          lease_until: string | null
          next_attempt_at: string
          notification_id: string
          scheduled_at: string
          status: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          notification_id: string
          scheduled_at?: string
          status?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          notification_id?: string
          scheduled_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_jobs_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string | null
          body_mode: string
          push: boolean
          recipient_kind: string
          title: string
          type: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          body?: string | null
          body_mode: string
          push: boolean
          recipient_kind: string
          title: string
          type: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          body?: string | null
          body_mode?: string
          push?: boolean
          recipient_kind?: string
          title?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          dedupe_key: string
          id: string
          payload: Json
          read_at: string | null
          recipient_id: string
          recipient_kind: string
          target_path: string
          type: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          id?: string
          payload: Json
          read_at?: string | null
          recipient_id: string
          recipient_kind: string
          target_path: string
          type: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          id?: string
          payload?: Json
          read_at?: string | null
          recipient_id?: string
          recipient_kind?: string
          target_path?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_type_recipient_kind_fkey"
            columns: ["type", "recipient_kind"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["type", "recipient_kind"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          hidden: boolean
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          hidden?: boolean
          id?: string
          name: string
          sort_order: number
        }
        Update: {
          created_at?: string
          hidden?: boolean
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_agorot: number
          amount_override_reason: string | null
          created_at: string
          customer_id: string | null
          id: string
          note: string | null
          paid_on: string
          payer_label: string | null
          payment_method_id: string | null
          product_id: string
          product_snapshot: Json
          provider: string | null
          provider_transaction_id: string | null
          recorded_by: string | null
          reference: string | null
          source: string
          status: string
        }
        Insert: {
          amount_agorot: number
          amount_override_reason?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          note?: string | null
          paid_on: string
          payer_label?: string | null
          payment_method_id?: string | null
          product_id: string
          product_snapshot: Json
          provider?: string | null
          provider_transaction_id?: string | null
          recorded_by?: string | null
          reference?: string | null
          source: string
          status?: string
        }
        Update: {
          amount_agorot?: number
          amount_override_reason?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          note?: string | null
          paid_on?: string
          payer_label?: string | null
          payment_method_id?: string | null
          product_id?: string
          product_snapshot?: Json
          provider?: string | null
          provider_transaction_id?: string | null
          recorded_by?: string | null
          reference?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          allowed_weekdays: number[] | null
          created_at: string
          eligible_event_kind: string
          id: string
          intro_only: boolean
          name: string
          party_size: number
          post_join_button_label: string | null
          post_join_message: string | null
          price_agorot: number
          type: string
          units: number
          validity_days: number | null
          validity_mode: string
        }
        Insert: {
          active?: boolean
          allowed_weekdays?: number[] | null
          created_at?: string
          eligible_event_kind: string
          id?: string
          intro_only?: boolean
          name: string
          party_size: number
          post_join_button_label?: string | null
          post_join_message?: string | null
          price_agorot: number
          type: string
          units: number
          validity_days?: number | null
          validity_mode: string
        }
        Update: {
          active?: boolean
          allowed_weekdays?: number[] | null
          created_at?: string
          eligible_event_kind?: string
          id?: string
          intro_only?: boolean
          name?: string
          party_size?: number
          post_join_button_label?: string | null
          post_join_message?: string | null
          price_agorot?: number
          type?: string
          units?: number
          validity_days?: number | null
          validity_mode?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          activated_at: string | null
          anonymized_at: string | null
          created_at: string
          dietary_notes: string | null
          full_name: string
          id: string
          pending_email: string | null
          phone_e164: string | null
          photo_consent: boolean
          photo_consent_at: string | null
          photo_consent_text_version: number | null
          privacy_consent_at: string | null
          privacy_policy_version: number | null
        }
        Insert: {
          activated_at?: string | null
          anonymized_at?: string | null
          created_at?: string
          dietary_notes?: string | null
          full_name: string
          id: string
          pending_email?: string | null
          phone_e164?: string | null
          photo_consent?: boolean
          photo_consent_at?: string | null
          photo_consent_text_version?: number | null
          privacy_consent_at?: string | null
          privacy_policy_version?: number | null
        }
        Update: {
          activated_at?: string | null
          anonymized_at?: string | null
          created_at?: string
          dietary_notes?: string | null
          full_name?: string
          id?: string
          pending_email?: string | null
          phone_e164?: string | null
          photo_consent?: boolean
          photo_consent_at?: string | null
          photo_consent_text_version?: number | null
          privacy_consent_at?: string | null
          privacy_policy_version?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      entitlement_balances: {
        Row: {
          available: number | null
          customer_id: string | null
          entitlement_id: string | null
          expired_before_bound: boolean | null
          expires_at: string | null
          expires_on: string | null
          is_expired: boolean | null
          kind: string | null
          original_units: number | null
          payment_id: string | null
          reserved: number | null
          status: string | null
          used: number | null
          valid_from: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_approve_payment: {
        Args: {
          p_amount_agorot: number
          p_amount_override_reason: string
          p_confirmed: boolean
          p_customer_id: string
          p_duplicate_confirmed: boolean
          p_event_id: string
          p_idempotency_key: string
          p_note: string
          p_paid_on: string
          p_payer_label: string
          p_payment_method_id: string
          p_product_id: string
          p_reference: string
        }
        Returns: Json
      }
      admin_begin_media_publish: {
        Args: {
          p_alt_text: string
          p_focus_x: number
          p_focus_y: number
          p_media_id: string
        }
        Returns: Json
      }
      admin_book_customer: {
        Args: {
          p_customer_id: string
          p_event_id: string
          p_idempotency_key: string
        }
        Returns: Json
      }
      admin_cancel_booking: {
        Args: {
          p_booking_id: string
          p_confirmed: boolean
          p_idempotency_key: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_create_event: {
        Args: { p_event: Json; p_idempotency_key: string }
        Returns: Json
      }
      admin_create_media: { Args: { p_idempotency_key: string }; Returns: Json }
      admin_create_product: {
        Args: { p_idempotency_key: string; p_product: Json }
        Returns: Json
      }
      admin_duplicate_event: {
        Args: {
          p_date: string
          p_end_time: string
          p_event_id: string
          p_idempotency_key: string
          p_start_time: string
        }
        Returns: Json
      }
      admin_finish_media_publish: {
        Args: { p_media_id: string }
        Returns: Json
      }
      admin_get_attention_items: { Args: never; Returns: Json }
      admin_get_content_page: { Args: { p_slug: string }; Returns: Json }
      admin_get_event_details: { Args: { p_event_id: string }; Returns: Json }
      admin_get_home: { Args: never; Returns: Json }
      admin_issue_link: {
        Args: {
          p_idempotency_key: string
          p_purpose: string
          p_target_id: string
        }
        Returns: Json
      }
      admin_list_bookable_events: { Args: never; Returns: Json }
      admin_list_links: { Args: never; Returns: Json }
      admin_list_payments: { Args: never; Returns: Json }
      admin_publish_content: {
        Args: { p_idempotency_key: string; p_slug: string }
        Returns: Json
      }
      admin_publish_event: {
        Args: { p_event_id: string; p_idempotency_key: string }
        Returns: Json
      }
      admin_revoke_link: {
        Args: { p_idempotency_key: string; p_token_id: string }
        Returns: Json
      }
      admin_search_customers: { Args: { p_query: string }; Returns: Json }
      admin_set_content_draft: {
        Args: { p_content: Json; p_key: string; p_slug: string }
        Returns: Json
      }
      admin_set_event_image: {
        Args: { p_event_id: string; p_media_id: string }
        Returns: Json
      }
      admin_set_product_price: {
        Args: {
          p_confirmed: boolean
          p_idempotency_key: string
          p_price_agorot: number
          p_product_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_update_event: {
        Args: { p_changes: Json; p_event_id: string; p_idempotency_key: string }
        Returns: Json
      }
      admin_update_product: {
        Args: {
          p_changes: Json
          p_idempotency_key: string
          p_product_id: string
        }
        Returns: Json
      }
      book_session: {
        Args: { p_event_id: string; p_idempotency_key: string }
        Returns: Json
      }
      book_sessions: {
        Args: { p_idempotency_key: string; p_items: string[] }
        Returns: Json
      }
      cancel_booking: {
        Args: {
          p_booking_id: string
          p_choice?: string
          p_idempotency_key: string
        }
        Returns: Json
      }
      claim_join: {
        Args: { p_idempotency_key: string; p_token: string }
        Returns: Json
      }
      get_event_availability: {
        Args: { p_event_ids: string[] }
        Returns: Json
      }
      get_my_bookings: { Args: never; Returns: Json }
      get_my_entitlements: { Args: never; Returns: Json }
      get_my_session_role: { Args: never; Returns: string }
      issue_reset_token: { Args: { p_user_id: string }; Returns: Json }
      join_begin: {
        Args: {
          p_email: string
          p_idempotency_key: string
          p_phone: string
          p_token: string
        }
        Returns: Json
      }
      join_complete: {
        Args: { p_idempotency_key: string; p_profile: Json; p_token: string }
        Returns: Json
      }
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: Json }
      mark_notifications_unread: { Args: { p_ids: string[] }; Returns: Json }
      preview_admin_approve_payment: {
        Args: {
          p_amount_agorot: number
          p_customer_id: string
          p_event_id: string
          p_paid_on: string
          p_payer_label: string
          p_payment_method_id: string
          p_product_id: string
        }
        Returns: Json
      }
      preview_admin_book_customer: {
        Args: { p_customer_id: string; p_event_id: string }
        Returns: Json
      }
      preview_admin_cancel_booking: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      preview_admin_set_product_price: {
        Args: { p_price_agorot: number; p_product_id: string }
        Returns: Json
      }
      preview_book_session: { Args: { p_event_id: string }; Returns: Json }
      preview_book_sessions: { Args: { p_items: string[] }; Returns: Json }
      reset_begin: {
        Args: { p_idempotency_key: string; p_token: string }
        Returns: Json
      }
      reset_complete: {
        Args: { p_idempotency_key: string; p_token: string }
        Returns: Json
      }
      set_photo_consent: { Args: { p_consent: boolean }; Returns: Json }
      token_view: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
