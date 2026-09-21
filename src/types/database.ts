export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          shift_id: string | null
          user_a: string
          user_b: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          shift_id?: string | null
          user_a: string
          user_b: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          shift_id?: string | null
          user_a?: string
          user_b?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      member_hr: {
        Row: {
          contract_hours: number | null
          contract_period: string | null
          member_id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          contract_hours?: number | null
          contract_period?: string | null
          member_id: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          contract_hours?: number | null
          contract_period?: string | null
          member_id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_hr_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_invites: {
        Row: {
          channel: string
          consumed_at: string | null
          created_at: string
          day_count: number
          day_started_at: string | null
          expires_at: string | null
          id: string
          last_sent_at: string | null
          member_id: string
          sent_count: number
          token_hash: string | null
        }
        Insert: {
          channel: string
          consumed_at?: string | null
          created_at?: string
          day_count?: number
          day_started_at?: string | null
          expires_at?: string | null
          id?: string
          last_sent_at?: string | null
          member_id: string
          sent_count?: number
          token_hash?: string | null
        }
        Update: {
          channel?: string
          consumed_at?: string | null
          created_at?: string
          day_count?: number
          day_started_at?: string | null
          expires_at?: string | null
          id?: string
          last_sent_at?: string | null
          member_id?: string
          sent_count?: number
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_invites_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_scope: {
        Row: {
          member_id: string
          venue_id: string
          workspace_id: string
        }
        Insert: {
          member_id: string
          venue_id: string
          workspace_id: string
        }
        Update: {
          member_id?: string
          venue_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_scope_member_id_workspace_id_fkey"
            columns: ["member_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "member_scope_venue_id_workspace_id_fkey"
            columns: ["venue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      messages: {
        Row: {
          absence_id: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          read_at: string | null
          request_id: string | null
          sender_id: string
        }
        Insert: {
          absence_id?: string | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          read_at?: string | null
          request_id?: string | null
          sender_id: string
        }
        Update: {
          absence_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          read_at?: string | null
          request_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_absence_id_fkey"
            columns: ["absence_id"]
            isOneToOne: false
            referencedRelation: "staff_absences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "shift_change_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          related_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          related_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          related_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_day: number | null
          birth_month: number | null
          city: string | null
          created_at: string
          deleted_at: string | null
          full_name: string | null
          id: string
          intro_seen: boolean
          notification_prefs: Json
          onboarding_complete: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          birth_day?: number | null
          birth_month?: number | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string | null
          id: string
          intro_seen?: boolean
          notification_prefs?: Json
          onboarding_complete?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          birth_day?: number | null
          birth_month?: number | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string | null
          id?: string
          intro_seen?: boolean
          notification_prefs?: Json
          onboarding_complete?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          platform: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rating: number
          receipt_ref: string | null
          reviewer_name: string | null
          shift_id: string | null
          status: string
          tags: string[]
          venue_id: string | null
          verified: boolean
          waiter_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          receipt_ref?: string | null
          reviewer_name?: string | null
          shift_id?: string | null
          status?: string
          tags?: string[]
          venue_id?: string | null
          verified?: boolean
          waiter_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          receipt_ref?: string | null
          reviewer_name?: string | null
          shift_id?: string | null
          status?: string
          tags?: string[]
          venue_id?: string | null
          verified?: boolean
          waiter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_assignments: {
        Row: {
          confirmed_at: string | null
          created_at: string
          id: string
          role_id: string | null
          shift_id: string
          status: Database["public"]["Enums"]["assignment_status"]
          venue_id: string
          venue_member_id: string
          worked_hours: number | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          role_id?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
          venue_id: string
          venue_member_id: string
          worked_hours?: number | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          role_id?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          venue_id?: string
          venue_member_id?: string
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_role_id_venue_id_fkey"
            columns: ["role_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_roles"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "shift_assignments_shift_id_venue_id_fkey"
            columns: ["shift_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "shift_assignments_venue_member_id_venue_id_fkey"
            columns: ["venue_member_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_members"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      shift_change_requests: {
        Row: {
          assignment_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["change_request_kind"]
          proposed_end_time: string | null
          proposed_start_time: string | null
          reason: string
          requested_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          shift_date: string
          shift_id: string
          status: Database["public"]["Enums"]["change_request_status"]
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["change_request_kind"]
          proposed_end_time?: string | null
          proposed_start_time?: string | null
          reason: string
          requested_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shift_date: string
          shift_id: string
          status?: Database["public"]["Enums"]["change_request_status"]
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["change_request_kind"]
          proposed_end_time?: string | null
          proposed_start_time?: string | null
          reason?: string
          requested_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shift_date?: string
          shift_id?: string
          status?: Database["public"]["Enums"]["change_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "shift_change_requests_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_change_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_change_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_role_requirements: {
        Row: {
          count: number
          created_at: string
          id: string
          role_id: string
          shift_id: string
          venue_id: string
        }
        Insert: {
          count?: number
          created_at?: string
          id?: string
          role_id: string
          shift_id: string
          venue_id: string
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          role_id?: string
          shift_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_role_requirements_role_id_venue_id_fkey"
            columns: ["role_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_roles"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "shift_role_requirements_shift_id_venue_id_fkey"
            columns: ["shift_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          date: string
          description: string | null
          end_time: string
          id: string
          positions_filled: number
          positions_total: number
          require_confirmation: boolean
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          title: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          date: string
          description?: string | null
          end_time: string
          id?: string
          positions_filled?: number
          positions_total?: number
          require_confirmation?: boolean
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"]
          title: string
          venue_id: string
        }
        Update: {
          created_at?: string
          date?: string
          description?: string | null
          end_time?: string
          id?: string
          positions_filled?: number
          positions_total?: number
          require_confirmation?: boolean
          start_time?: string
          status?: Database["public"]["Enums"]["shift_status"]
          title?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_absences: {
        Row: {
          created_at: string
          end_date: string
          end_time: string | null
          id: string
          inps_protocol: string | null
          kind: Database["public"]["Enums"]["absence_kind"]
          member_id: string
          note: string | null
          requested_by: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          start_date: string
          start_time: string | null
          status: Database["public"]["Enums"]["absence_status"]
        }
        Insert: {
          created_at?: string
          end_date: string
          end_time?: string | null
          id?: string
          inps_protocol?: string | null
          kind: Database["public"]["Enums"]["absence_kind"]
          member_id: string
          note?: string | null
          requested_by?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          start_date: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["absence_status"]
        }
        Update: {
          created_at?: string
          end_date?: string
          end_time?: string | null
          id?: string
          inps_protocol?: string | null
          kind?: Database["public"]["Enums"]["absence_kind"]
          member_id?: string
          note?: string | null
          requested_by?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          start_date?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["absence_status"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_absences_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_absences_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_absences_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_documents: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          member_id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          member_id: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          member_id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_member_roles: {
        Row: {
          created_at: string
          role_id: string
          venue_id: string
          venue_member_id: string
        }
        Insert: {
          created_at?: string
          role_id: string
          venue_id: string
          venue_member_id: string
        }
        Update: {
          created_at?: string
          role_id?: string
          venue_id?: string
          venue_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_member_roles_role_id_venue_id_fkey"
            columns: ["role_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_roles"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "venue_member_roles_venue_member_id_venue_id_fkey"
            columns: ["venue_member_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_members"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      venue_members: {
        Row: {
          created_at: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          id: string
          left_at: string | null
          member_id: string
          venue_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          left_at?: string | null
          member_id: string
          venue_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          left_at?: string | null
          member_id?: string
          venue_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_members_member_id_workspace_id_fkey"
            columns: ["member_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "venue_members_venue_id_workspace_id_fkey"
            columns: ["venue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      venue_roles: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
          venue_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          venue_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_roles_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          city: string | null
          closed_at: string | null
          created_at: string
          cuisine_type: string | null
          description: string | null
          id: string
          logo_url: string | null
          name: string
          staff_sees_planning: boolean
          workspace_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          closed_at?: string | null
          created_at?: string
          cuisine_type?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          staff_sees_planning?: boolean
          workspace_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          closed_at?: string | null
          created_at?: string
          cuisine_type?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          staff_sees_planning?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_profiles: {
        Row: {
          id: string
          languages: string[]
          primary_role: string | null
          rating_avg: number
          rating_count: number
        }
        Insert: {
          id: string
          languages?: string[]
          primary_role?: string | null
          rating_avg?: number
          rating_count?: number
        }
        Update: {
          id?: string
          languages?: string[]
          primary_role?: string | null
          rating_avg?: number
          rating_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "waiter_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          authority: Database["public"]["Enums"]["member_authority"]
          can_documents: boolean
          can_hours: boolean
          can_shifts: boolean
          can_staff: boolean
          can_venue: boolean
          created_at: string
          display_name: string
          email: string | null
          id: string
          left_at: string | null
          link_conflict_at: string | null
          phone: string | null
          scope: Database["public"]["Enums"]["venue_scope"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          authority?: Database["public"]["Enums"]["member_authority"]
          can_documents?: boolean
          can_hours?: boolean
          can_shifts?: boolean
          can_staff?: boolean
          can_venue?: boolean
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          left_at?: string | null
          link_conflict_at?: string | null
          phone?: string | null
          scope?: Database["public"]["Enums"]["venue_scope"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          authority?: Database["public"]["Enums"]["member_authority"]
          can_documents?: boolean
          can_hours?: boolean
          can_shifts?: boolean
          can_staff?: boolean
          can_venue?: boolean
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          left_at?: string | null
          link_conflict_at?: string | null
          phone?: string | null
          scope?: Database["public"]["Enums"]["venue_scope"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          plan: string
          staff_can_chat: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          plan?: string
          staff_can_chat?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          plan?: string
          staff_can_chat?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      waiter_public_cards: {
        Row: {
          avatar_url: string | null
          city: string | null
          full_name: string | null
          id: string | null
          primary_role: string | null
          rating_avg: number | null
          rating_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_member: {
        Args: {
          p_authority?: Database["public"]["Enums"]["member_authority"]
          p_perms?: Json
          p_person?: Json
          p_scope?: Database["public"]["Enums"]["venue_scope"]
          p_self?: boolean
          p_venues?: Json
          p_workspace: string
        }
        Returns: Json
      }
      assign: {
        Args: { p_role?: string; p_shift: string; p_venue_member: string }
        Returns: string
      }
      claim_invite_send: {
        Args: {
          p_caller: string
          p_expires?: string
          p_member: string
          p_token_hash?: string
        }
        Returns: {
          channel: string
          display_name: string
          email: string
          venue_names: string[]
          workspace_name: string
        }[]
      }
      claim_invites: { Args: never; Returns: number }
      consume_invite: {
        Args: { p_hash: string; p_user: string }
        Returns: string
      }
      create_shifts: { Args: { p_plans: Json }; Returns: string[] }
      create_venue: {
        Args: {
          p_address?: string
          p_city?: string
          p_cuisine_type?: string
          p_description?: string
          p_logo_url?: string
          p_name: string
          p_workspace: string
        }
        Returns: string
      }
      create_workspace: { Args: { p_name: string }; Returns: string }
      delete_account: { Args: { p_user: string }; Returns: undefined }
      delete_shift: { Args: { p_shift: string }; Returns: undefined }
      get_absence_availability: {
        Args: { p_from: string; p_to: string }
        Returns: {
          end_date: string
          end_time: string
          id: string
          member_id: string
          start_date: string
          start_time: string
          status: Database["public"]["Enums"]["absence_status"]
        }[]
      }
      get_absence_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          ferie_days: number
          inps_protocols: string
          malattia_days: number
          member_id: string
          member_name: string
          permesso_days: number
          permesso_hours: number
        }[]
      }
      get_chat_counterparts: {
        Args: { p_conversations: string[] }
        Returns: {
          avatar_url: string
          conversation_id: string
          name: string
          subtitle: string
        }[]
      }
      get_chat_unread_count: { Args: never; Returns: number }
      get_hours_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          hours: number
          member_id: string
          member_name: string
          roles: string
          shifts_count: number
          venue_closed: boolean
          venue_id: string
          venue_name: string
        }[]
      }
      get_member_performance: {
        Args: { p_member: string }
        Returns: {
          declined_count: number
          month_hours: number
          month_shifts: number
          no_show_count: number
          past_total: number
          total_hours: number
          worked_count: number
        }[]
      }
      get_member_worked_shifts: {
        Args: { p_limit?: number; p_member: string }
        Returns: {
          date: string
          end_time: string
          hours: number
          id: string
          shift_id: string
          start_time: string
          status: Database["public"]["Enums"]["assignment_status"]
          title: string
          venue_id: string
          venue_name: string
          worked_hours: number
        }[]
      }
      get_my_context: { Args: never; Returns: Json }
      get_my_work_history: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          date: string
          end_time: string
          hours: number
          key: string
          logo_url: string
          start_time: string
          title: string
          venue_name: string
        }[]
      }
      get_my_work_history_page: {
        Args: {
          p_before_date?: string
          p_before_key?: string
          p_limit?: number
        }
        Returns: {
          date: string
          end_time: string
          hours: number
          key: string
          logo_url: string
          start_time: string
          title: string
          venue_name: string
        }[]
      }
      get_my_work_history_range: {
        Args: { p_from: string; p_to: string }
        Returns: {
          date: string
          end_time: string
          hours: number
          key: string
          logo_url: string
          start_time: string
          title: string
          venue_name: string
        }[]
      }
      get_my_work_history_totals: {
        Args: never
        Returns: {
          total_count: number
          total_hours: number
        }[]
      }
      get_my_work_totals: {
        Args: { p_from: string; p_to: string }
        Returns: {
          total_count: number
          total_hours: number
        }[]
      }
      get_rating_breakdown: {
        Args: { p_waiter: string }
        Returns: {
          cnt: number
          rating: number
        }[]
      }
      get_staff_planning: {
        Args: { p_from: string; p_to: string }
        Returns: {
          avatar_url: string
          date: string
          end_time: string
          is_me: boolean
          member_name: string
          role_name: string
          shift_id: string
          start_time: string
          title: string
          venue_id: string
          venue_logo_url: string
          venue_member_id: string
          venue_name: string
        }[]
      }
      get_waiter_public_card: {
        Args: { p_waiter: string }
        Returns: {
          avatar_url: string
          city: string
          full_name: string
          id: string
          primary_role: string
          rating_avg: number
          rating_count: number
        }[]
      }
      get_workspace_contacts: {
        Args: never
        Returns: {
          avatar_url: string
          is_manager: boolean
          member_id: string
          name: string
          user_id: string
          venues: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      leave: {
        Args: { p_member: string; p_venue?: string }
        Returns: undefined
      }
      local_now: { Args: never; Returns: string }
      mark_conversation_read: {
        Args: { p_conversation: string }
        Returns: undefined
      }
      move_assignment: {
        Args: { p_assignment: string; p_to_date?: string; p_to_shift?: string }
        Returns: string
      }
      notification_category: {
        Args: { t: Database["public"]["Enums"]["notification_type"] }
        Returns: string
      }
      open_conversation: {
        Args: { p_member?: string; p_workspace?: string }
        Returns: string
      }
      peek_invite: {
        Args: { p_hash: string }
        Returns: {
          display_name: string
          email: string
          workspace_name: string
        }[]
      }
      reassign: {
        Args: { p_assignment: string; p_to_venue_member: string }
        Returns: string
      }
      record_absence: {
        Args: {
          p_end: string
          p_end_time?: string
          p_inps_protocol?: string
          p_kind: Database["public"]["Enums"]["absence_kind"]
          p_member: string
          p_note?: string
          p_start: string
          p_start_time?: string
        }
        Returns: string
      }
      record_attendance: {
        Args: { p_assignment: string; p_patch: Json }
        Returns: {
          confirmed_at: string | null
          created_at: string
          id: string
          role_id: string | null
          shift_id: string
          status: Database["public"]["Enums"]["assignment_status"]
          venue_id: string
          venue_member_id: string
          worked_hours: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shift_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      remove_member: {
        Args: { p_member: string; p_venue?: string }
        Returns: undefined
      }
      request_absence: {
        Args: {
          p_end: string
          p_end_time?: string
          p_inps_protocol?: string
          p_kind: Database["public"]["Enums"]["absence_kind"]
          p_note?: string
          p_start: string
          p_start_time?: string
          p_workspace: string
        }
        Returns: string
      }
      request_shift_change: {
        Args: {
          p_assignment: string
          p_end?: string
          p_kind?: Database["public"]["Enums"]["change_request_kind"]
          p_reason: string
          p_start?: string
        }
        Returns: string
      }
      resolve_absence: {
        Args: { p_absence: string; p_approve: boolean; p_note?: string }
        Returns: undefined
      }
      resolve_shift_change_request: {
        Args: {
          p_approve: boolean
          p_note?: string
          p_replacement?: string
          p_request: string
        }
        Returns: undefined
      }
      respond_assignment: {
        Args: {
          p_assignment: string
          p_status: Database["public"]["Enums"]["assignment_status"]
        }
        Returns: {
          confirmed_at: string | null
          created_at: string
          id: string
          role_id: string | null
          shift_id: string
          status: Database["public"]["Enums"]["assignment_status"]
          venue_id: string
          venue_member_id: string
          worked_hours: number | null
        }
        SetofOptions: {
          from: "*"
          to: "shift_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_to_invite: {
        Args: { p_accept: boolean; p_member: string }
        Returns: undefined
      }
      set_absence_inps_protocol: {
        Args: { p_absence: string; p_protocol: string }
        Returns: undefined
      }
      set_assignment_role: {
        Args: { p_assignment: string; p_role: string }
        Returns: undefined
      }
      set_member_access: {
        Args: {
          p_authority: Database["public"]["Enums"]["member_authority"]
          p_member: string
          p_perms?: Json
          p_scope?: Database["public"]["Enums"]["venue_scope"]
          p_scope_venues?: string[]
        }
        Returns: undefined
      }
      set_member_roles: {
        Args: { p_role_ids: string[]; p_venue_member: string }
        Returns: undefined
      }
      set_member_venue: {
        Args: {
          p_employment_type?: Database["public"]["Enums"]["employment_type"]
          p_member: string
          p_role_ids?: string[]
          p_venue: string
        }
        Returns: string
      }
      set_shift_status: {
        Args: {
          p_shift: string
          p_status: Database["public"]["Enums"]["shift_status"]
        }
        Returns: undefined
      }
      set_venue_closed: {
        Args: { p_closed: boolean; p_venue: string }
        Returns: undefined
      }
      shift_duration_hours: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      shift_ends_at: {
        Args: { p_date: string; p_end: string; p_start: string }
        Returns: string
      }
      transfer_ownership: {
        Args: { p_member: string; p_workspace: string }
        Returns: undefined
      }
      unassign: { Args: { p_assignment: string }; Returns: undefined }
      update_member: {
        Args: { p_member: string; p_patch: Json }
        Returns: undefined
      }
      update_shift: {
        Args: { p_payload: Json; p_shift: string }
        Returns: undefined
      }
      withdraw_absence: { Args: { p_absence: string }; Returns: undefined }
      withdraw_shift_change_request: {
        Args: { p_request: string }
        Returns: undefined
      }
    }
    Enums: {
      absence_kind: "ferie" | "permesso" | "malattia"
      absence_status: "pending" | "approved" | "rejected" | "withdrawn"
      assignment_status: "assigned" | "confirmed" | "declined" | "no_show"
      change_request_kind: "substitution" | "hours"
      change_request_status: "pending" | "approved" | "rejected" | "withdrawn"
      employment_type: "fisso" | "a_chiamata"
      member_authority: "owner" | "collaborator" | "none"
      member_status: "invited" | "active" | "left"
      message_kind:
        | "text"
        | "shift_change_request"
        | "shift_change_response"
        | "absence_request"
        | "absence_response"
      notification_type:
        | "new_message"
        | "shift_assigned"
        | "staff_invite"
        | "staff_response"
        | "staff_removed"
        | "shift_cancelled"
        | "shift_updated"
        | "shift_unassigned"
        | "shift_change_request"
        | "shift_change_response"
        | "shift_declined"
        | "staff_linked"
        | "team_linked"
        | "team_joined"
        | "team_removed"
        | "absence_request"
        | "absence_response"
        | "absence_sick"
      shift_status: "open" | "closed" | "cancelled"
      venue_scope: "all" | "selected"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      absence_kind: ["ferie", "permesso", "malattia"],
      absence_status: ["pending", "approved", "rejected", "withdrawn"],
      assignment_status: ["assigned", "confirmed", "declined", "no_show"],
      change_request_kind: ["substitution", "hours"],
      change_request_status: ["pending", "approved", "rejected", "withdrawn"],
      employment_type: ["fisso", "a_chiamata"],
      member_authority: ["owner", "collaborator", "none"],
      member_status: ["invited", "active", "left"],
      message_kind: [
        "text",
        "shift_change_request",
        "shift_change_response",
        "absence_request",
        "absence_response",
      ],
      notification_type: [
        "new_message",
        "shift_assigned",
        "staff_invite",
        "staff_response",
        "staff_removed",
        "shift_cancelled",
        "shift_updated",
        "shift_unassigned",
        "shift_change_request",
        "shift_change_response",
        "shift_declined",
        "staff_linked",
        "team_linked",
        "team_joined",
        "team_removed",
        "absence_request",
        "absence_response",
        "absence_sick",
      ],
      shift_status: ["open", "closed", "cancelled"],
      venue_scope: ["all", "selected"],
    },
  },
} as const
