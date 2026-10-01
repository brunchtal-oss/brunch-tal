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
          conflict_reason: string | null
          consumed_at: string | null
          created_at: string
          customer_id: string | null
          expires_at: string
          id: string
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
          conflict_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at: string
          id?: string
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
          conflict_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at?: string
          id?: string
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
      business_settings: {
        Row: {
          admin_expiring_days: number
          cancel_window_hours: number
          credit_options_count: number
          customer_expiring_days: number
          default_capacity_couple: number
          default_capacity_regular: number
          default_prep_days: number[]
          default_validity_days: number
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
          default_validity_days?: number
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
          default_validity_days?: number
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
          full_name: string
          id: string
        }
        Insert: {
          activated_at?: string | null
          anonymized_at?: string | null
          created_at?: string
          full_name: string
          id: string
        }
        Update: {
          activated_at?: string | null
          anonymized_at?: string | null
          created_at?: string
          full_name?: string
          id?: string
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
          p_event_id: string
          p_idempotency_key: string
          p_note: string
          p_paid_on: string
          p_payment_method_id: string
          p_product_id: string
          p_reference: string
        }
        Returns: Json
      }
      get_my_session_role: { Args: never; Returns: string }
      issue_reset_token: { Args: { p_user_id: string }; Returns: Json }
      preview_admin_approve_payment: {
        Args: {
          p_amount_agorot: number
          p_event_id: string
          p_paid_on: string
          p_product_id: string
        }
        Returns: Json
      }
      reset_begin: {
        Args: { p_idempotency_key: string; p_token: string }
        Returns: Json
      }
      reset_complete: {
        Args: { p_idempotency_key: string; p_token: string }
        Returns: Json
      }
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
