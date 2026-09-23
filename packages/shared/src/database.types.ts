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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      listings: {
        Row: {
          brand: string | null
          category_id: number | null
          condition: string | null
          country: string | null
          currency: string
          description: string | null
          external_id: string
          first_seen_at: string
          id: number
          location: string | null
          photo_url: string | null
          posted_at: string | null
          previous_price: number | null
          price: number | null
          price_changed_at: string | null
          refreshed_at: string | null
          seller_business: boolean | null
          seller_id: string | null
          source: string
          title: string
          url: string
        }
        Insert: {
          brand?: string | null
          category_id?: number | null
          condition?: string | null
          country?: string | null
          currency?: string
          description?: string | null
          external_id: string
          first_seen_at?: string
          id?: never
          location?: string | null
          photo_url?: string | null
          posted_at?: string | null
          previous_price?: number | null
          price?: number | null
          price_changed_at?: string | null
          refreshed_at?: string | null
          seller_business?: boolean | null
          seller_id?: string | null
          source: string
          title: string
          url: string
        }
        Update: {
          brand?: string | null
          category_id?: number | null
          condition?: string | null
          country?: string | null
          currency?: string
          description?: string | null
          external_id?: string
          first_seen_at?: string
          id?: never
          location?: string | null
          photo_url?: string | null
          posted_at?: string | null
          previous_price?: number | null
          price?: number | null
          price_changed_at?: string | null
          refreshed_at?: string | null
          seller_business?: boolean | null
          seller_id?: string | null
          source?: string
          title?: string
          url?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          ai_score: number | null
          ai_status: string
          created_at: string
          discount_pct: number | null
          id: number
          listing_id: number
          median_price: number | null
          notified: boolean
          price: number | null
          reason: string | null
          red_flags: string[]
          rule_score: number | null
          score: number | null
          tier: string
          updated_at: string
          watch_id: string
        }
        Insert: {
          ai_score?: number | null
          ai_status?: string
          created_at?: string
          discount_pct?: number | null
          id?: never
          listing_id: number
          median_price?: number | null
          notified?: boolean
          price?: number | null
          reason?: string | null
          red_flags?: string[]
          rule_score?: number | null
          score?: number | null
          tier?: string
          updated_at?: string
          watch_id: string
        }
        Update: {
          ai_score?: number | null
          ai_status?: string
          created_at?: string
          discount_pct?: number | null
          id?: never
          listing_id?: number
          median_price?: number | null
          notified?: boolean
          price?: number | null
          reason?: string | null
          red_flags?: string[]
          rule_score?: number | null
          score?: number | null
          tier?: string
          updated_at?: string
          watch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "watches"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          devices_failed: number
          devices_ok: number
          error: string | null
          id: number
          kind: string
          latency_ms: number | null
          match_id: number | null
          status: string
          title: string
          url: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          devices_failed?: number
          devices_ok?: number
          error?: string | null
          id?: never
          kind: string
          latency_ms?: number | null
          match_id?: number | null
          status: string
          title: string
          url?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          devices_failed?: number
          devices_ok?: number
          error?: string | null
          id?: never
          kind?: string
          latency_ms?: number | null
          match_id?: number | null
          status?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failures: number
          id: number
          label: string | null
          last_success_at: string | null
          p256dh: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failures?: number
          id?: never
          label?: string | null
          last_success_at?: string | null
          p256dh: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failures?: number
          id?: never
          label?: string | null
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      runs: {
        Row: {
          duration_ms: number | null
          error: string | null
          http_status: number | null
          id: number
          items_new: number
          items_read: number
          kind: string
          matches: number
          scope: string
          source: string
          started_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: never
          items_new?: number
          items_read?: number
          kind: string
          matches?: number
          scope: string
          source: string
          started_at?: string
          status: string
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          http_status?: number | null
          id?: never
          items_new?: number
          items_read?: number
          kind?: string
          matches?: number
          scope?: string
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          active_from: string
          active_to: string
          ai_enabled: boolean
          candidate_threshold: number
          global_context: string
          global_exclude: string[]
          id: boolean
          notify_threshold: number
          olx_categories: number[]
          olx_interval_s: number
          olx_search_interval_s: number
          push_enabled: boolean
          timezone: string
          updated_at: string
          vinted_catalogs: number[]
          vinted_countries: string[]
          vinted_interval_s: number
          vinted_search_interval_s: number
        }
        Insert: {
          active_from?: string
          active_to?: string
          ai_enabled?: boolean
          candidate_threshold?: number
          global_context?: string
          global_exclude?: string[]
          id?: boolean
          notify_threshold?: number
          olx_categories?: number[]
          olx_interval_s?: number
          olx_search_interval_s?: number
          push_enabled?: boolean
          timezone?: string
          updated_at?: string
          vinted_catalogs?: number[]
          vinted_countries?: string[]
          vinted_interval_s?: number
          vinted_search_interval_s?: number
        }
        Update: {
          active_from?: string
          active_to?: string
          ai_enabled?: boolean
          candidate_threshold?: number
          global_context?: string
          global_exclude?: string[]
          id?: boolean
          notify_threshold?: number
          olx_categories?: number[]
          olx_interval_s?: number
          olx_search_interval_s?: number
          push_enabled?: boolean
          timezone?: string
          updated_at?: string
          vinted_catalogs?: number[]
          vinted_countries?: string[]
          vinted_interval_s?: number
          vinted_search_interval_s?: number
        }
        Relationships: []
      }
      watches: {
        Row: {
          active: boolean
          category: string
          context: string
          created_at: string
          exclude: string[]
          good_price: number | null
          id: string
          include_all: string[]
          include_any: string[]
          name: string
          olx_category_ids: number[]
          price_max: number | null
          price_min: number | null
          search_remote: boolean
          sources: string[]
          target_price: number | null
          updated_at: string
          vinted_catalog_ids: number[]
        }
        Insert: {
          active?: boolean
          category?: string
          context?: string
          created_at?: string
          exclude?: string[]
          good_price?: number | null
          id?: string
          include_all?: string[]
          include_any?: string[]
          name: string
          olx_category_ids?: number[]
          price_max?: number | null
          price_min?: number | null
          search_remote?: boolean
          sources?: string[]
          target_price?: number | null
          updated_at?: string
          vinted_catalog_ids?: number[]
        }
        Update: {
          active?: boolean
          category?: string
          context?: string
          created_at?: string
          exclude?: string[]
          good_price?: number | null
          id?: string
          include_all?: string[]
          include_any?: string[]
          name?: string
          olx_category_ids?: number[]
          price_max?: number | null
          price_min?: number | null
          search_remote?: boolean
          sources?: string[]
          target_price?: number | null
          updated_at?: string
          vinted_catalog_ids?: number[]
        }
        Relationships: []
      }
      worker_status: {
        Row: {
          heartbeat_at: string | null
          id: string
          last_error: string | null
          last_error_at: string | null
          olx_paused_until: string | null
          started_at: string | null
          version: string | null
          vinted_paused_until: string | null
        }
        Insert: {
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          olx_paused_until?: string | null
          started_at?: string | null
          version?: string | null
          vinted_paused_until?: string | null
        }
        Update: {
          heartbeat_at?: string | null
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          olx_paused_until?: string | null
          started_at?: string | null
          version?: string | null
          vinted_paused_until?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      purge_old_data: { Args: never; Returns: undefined }
      worker_watchdog: { Args: never; Returns: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
