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
      applications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          shift_id: string
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
          waiter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          waiter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          waiter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          manager_id: string
          shift_id: string | null
          waiter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id: string
          shift_id?: string | null
          waiter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string
          shift_id?: string | null
          waiter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
          bio: string | null
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
          plan: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
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
          plan?: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
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
          plan?: string
          role?: Database["public"]["Enums"]["user_role"]
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
          staff_member_id: string
          status: Database["public"]["Enums"]["assignment_status"]
          worked_hours: number | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          role_id?: string | null
          shift_id: string
          staff_member_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
          worked_hours?: number | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          role_id?: string | null
          shift_id?: string
          staff_member_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "venue_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
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
        }
        Insert: {
          count?: number
          created_at?: string
          id?: string
          role_id: string
          shift_id: string
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          role_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_role_requirements_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "venue_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_role_requirements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          date: string
          description: string | null
          dress_code: string | null
          end_time: string
          hourly_rate: number | null
          id: string
          kind: Database["public"]["Enums"]["shift_kind"]
          positions_filled: number
          positions_total: number
          require_confirmation: boolean
          requirements: string[] | null
          start_time: string
          status: Database["public"]["Enums"]["shift_status"]
          title: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          date: string
          description?: string | null
          dress_code?: string | null
          end_time: string
          hourly_rate?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["shift_kind"]
          positions_filled?: number
          positions_total?: number
          require_confirmation?: boolean
          requirements?: string[] | null
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"]
          title: string
          venue_id: string
        }
        Update: {
          created_at?: string
          date?: string
          description?: string | null
          dress_code?: string | null
          end_time?: string
          hourly_rate?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["shift_kind"]
          positions_filled?: number
          positions_total?: number
          require_confirmation?: boolean
          requirements?: string[] | null
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
          note: string | null
          owner_id: string
          person_id: string
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
          note?: string | null
          owner_id: string
          person_id: string
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
          note?: string | null
          owner_id?: string
          person_id?: string
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
            foreignKeyName: "staff_absences_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_absences_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "staff_people"
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
          mime_type: string | null
          name: string
          person_id: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          mime_type?: string | null
          name: string
          person_id: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          person_id?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_documents_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "staff_people"
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
      staff_member_roles: {
        Row: {
          created_at: string
          role_id: string
          staff_member_id: string
        }
        Insert: {
          created_at?: string
          role_id: string
          staff_member_id: string
        }
        Update: {
          created_at?: string
          role_id?: string
          staff_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_member_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "venue_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_member_roles_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          created_at: string
          display_name: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          id: string
          left_at: string | null
          link_status: Database["public"]["Enums"]["staff_link_status"]
          note: string | null
          person_id: string
          phone: string | null
          venue_id: string
          waiter_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          left_at?: string | null
          link_status?: Database["public"]["Enums"]["staff_link_status"]
          note?: string | null
          person_id: string
          phone?: string | null
          venue_id: string
          waiter_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          left_at?: string | null
          link_status?: Database["public"]["Enums"]["staff_link_status"]
          note?: string | null
          person_id?: string
          phone?: string | null
          venue_id?: string
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "staff_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_people: {
        Row: {
          contract_hours: number | null
          contract_period: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          invite_conflict_at: string | null
          invite_count: number
          invited_at: string | null
          note: string | null
          owner_id: string
          phone: string | null
          updated_at: string
          waiter_id: string | null
        }
        Insert: {
          contract_hours?: number | null
          contract_period?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          invite_conflict_at?: string | null
          invite_count?: number
          invited_at?: string | null
          note?: string | null
          owner_id: string
          phone?: string | null
          updated_at?: string
          waiter_id?: string | null
        }
        Update: {
          contract_hours?: number | null
          contract_period?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          invite_conflict_at?: string | null
          invite_count?: number
          invited_at?: string | null
          note?: string | null
          owner_id?: string
          phone?: string | null
          updated_at?: string
          waiter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_people_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_people_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      venue_access: {
        Row: {
          can_manage_documents: boolean
          can_manage_shifts: boolean
          can_manage_staff: boolean
          can_manage_venue: boolean
          can_view_hours: boolean
          created_at: string
          email: string | null
          id: string
          invite_count: number
          invited_at: string | null
          owner_id: string
          status: string
          updated_at: string
          user_id: string | null
          venue_id: string
        }
        Insert: {
          can_manage_documents?: boolean
          can_manage_shifts?: boolean
          can_manage_staff?: boolean
          can_manage_venue?: boolean
          can_view_hours?: boolean
          created_at?: string
          email?: string | null
          id?: string
          invite_count?: number
          invited_at?: string | null
          owner_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
          venue_id: string
        }
        Update: {
          can_manage_documents?: boolean
          can_manage_shifts?: boolean
          can_manage_staff?: boolean
          can_manage_venue?: boolean
          can_view_hours?: boolean
          created_at?: string
          email?: string | null
          id?: string
          invite_count?: number
          invited_at?: string | null
          owner_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_access_venue_id_fkey"
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
          owner_id: string
          staff_sees_planning: boolean
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
          owner_id: string
          staff_sees_planning?: boolean
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
          owner_id?: string
          staff_sees_planning?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "venues_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_experiences: {
        Row: {
          company_name: string
          created_at: string
          detail: string | null
          end_year: number | null
          id: string
          role: string | null
          start_year: number | null
          waiter_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          detail?: string | null
          end_year?: number | null
          id?: string
          role?: string | null
          start_year?: number | null
          waiter_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          detail?: string | null
          end_year?: number | null
          id?: string
          role?: string | null
          start_year?: number | null
          waiter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiter_experiences_waiter_id_fkey"
            columns: ["waiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_profiles: {
        Row: {
          availability_days: string[] | null
          cv_url: string | null
          documents: string[] | null
          experience: string | null
          hourly_rate_min: number | null
          id: string
          languages: string[]
          primary_role: string | null
          rating_avg: number
          rating_count: number
          specializations: string | null
          years_experience: number | null
        }
        Insert: {
          availability_days?: string[] | null
          cv_url?: string | null
          documents?: string[] | null
          experience?: string | null
          hourly_rate_min?: number | null
          id: string
          languages?: string[]
          primary_role?: string | null
          rating_avg?: number
          rating_count?: number
          specializations?: string | null
          years_experience?: number | null
        }
        Update: {
          availability_days?: string[] | null
          cv_url?: string | null
          documents?: string[] | null
          experience?: string | null
          hourly_rate_min?: number | null
          id?: string
          languages?: string[]
          primary_role?: string | null
          rating_avg?: number
          rating_count?: number
          specializations?: string | null
          years_experience?: number | null
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
      can_manage_person: {
        Args: { p_perm?: string; p_person: string }
        Returns: boolean
      }
      can_access_staff_person_documents: {
        Args: { p_person: string }
        Returns: boolean
      }
      chat_counterpart: {
        Args: { p_is_manager: boolean; p_user: string }
        Returns: {
          avatar_url: string
          name: string
        }[]
      }
      claim_staff_invite_send: {
        Args: { p_owner: string; p_person: string }
        Returns: {
          email: string
          full_name: string
          owner_name: string
          venue_names: string[]
        }[]
      }
      can_manage_venue: {
        Args: { p_perm?: string; p_venue: string }
        Returns: boolean
      }
      claim_staff_invites: { Args: never; Returns: number }
      conversation_for_pair: {
        Args: { p_manager: string; p_shift: string; p_waiter: string }
        Returns: string
      }
      delete_account: { Args: { p_user: string }; Returns: undefined }
      find_team_candidate: {
        Args: { p_email: string }
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          role: string
        }[]
      }
      find_waiter_by_email: {
        Args: { p_email: string }
        Returns: {
          avatar_url: string
          city: string
          full_name: string
          id: string
        }[]
      }
      get_chat_counterparts: {
        Args: { p_conversations: string[] }
        Returns: {
          avatar_url: string
          conversation_id: string
          name: string
        }[]
      }
      get_chat_unread_count: { Args: never; Returns: number }
      get_my_work_history: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          date: string
          end_time: string
          hours: number
          key: string
          kind: string
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
      get_owner_hours_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          hours: number
          person_id: string
          person_name: string
          roles: string
          shifts_count: number
          venue_closed: boolean
          venue_id: string
          venue_name: string
        }[]
      }
      get_person_performance: {
        Args: { p_person: string }
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
      get_person_worked_shifts: {
        Args: { p_limit?: number; p_person: string }
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
      get_rating_breakdown: {
        Args: { p_waiter: string }
        Returns: {
          cnt: number
          rating: number
        }[]
      }
      get_staff_performance: {
        Args: { p_staff_member: string }
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
      get_staff_planning: {
        Args: { p_from: string; p_to: string }
        Returns: {
          avatar_url: string
          date: string
          end_time: string
          is_me: boolean
          person_name: string
          role_name: string
          shift_id: string
          staff_member_id: string
          start_time: string
          title: string
          venue_id: string
          venue_logo_url: string
          venue_name: string
        }[]
      }
      get_staff_worked_shifts: {
        Args: { p_limit?: number; p_staff_member: string }
        Returns: {
          date: string
          end_time: string
          hours: number
          id: string
          shift_id: string
          start_time: string
          status: Database["public"]["Enums"]["assignment_status"]
          title: string
          worked_hours: number
        }[]
      }
      get_venue_hours_summary: {
        Args: { p_from: string; p_to: string; p_venue: string }
        Returns: {
          display_name: string
          hours: number
          roles: string
          shifts_count: number
          staff_member_id: string
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
      get_worked_with_waiters: {
        Args: { p_venue: string }
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          primary_role: string
        }[]
      }
      is_my_assigned_shift: { Args: { p_shift: string }; Returns: boolean }
      leave_venue: { Args: { p_staff_id: string }; Returns: undefined }
      link_staff_invites_for_user: { Args: { p_user: string }; Returns: number }
      local_now: { Args: never; Returns: string }
      mark_conversation_read: {
        Args: { p_conversation: string }
        Returns: undefined
      }
      notification_category: {
        Args: { t: Database["public"]["Enums"]["notification_type"] }
        Returns: string
      }
      reassign_shift_assignment: {
        Args: { p_assignment: string; p_staff_member: string }
        Returns: string
      }
      record_absence: {
        Args: {
          p_end: string
          p_end_time?: string
          p_inps_protocol?: string
          p_kind: Database["public"]["Enums"]["absence_kind"]
          p_note?: string
          p_person: string
          p_start: string
          p_start_time?: string
        }
        Returns: string
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      remove_staff_member: { Args: { p_staff_id: string }; Returns: undefined }
      request_absence: {
        Args: {
          p_end: string
          p_end_time?: string
          p_inps_protocol?: string
          p_kind: Database["public"]["Enums"]["absence_kind"]
          p_note?: string
          p_owner: string
          p_start: string
          p_start_time?: string
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
      respond_to_staff_invite: {
        Args: { p_accept: boolean; p_staff_id: string }
        Returns: undefined
      }
      set_absence_inps_protocol: {
        Args: { p_absence: string; p_protocol: string }
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
      withdraw_absence: { Args: { p_absence: string }; Returns: undefined }
      withdraw_shift_change_request: {
        Args: { p_request: string }
        Returns: undefined
      }
    }
    Enums: {
      absence_kind: "ferie" | "permesso" | "malattia"
      absence_status: "pending" | "approved" | "rejected" | "withdrawn"
      application_status: "pending" | "accepted" | "rejected" | "cancelled"
      assignment_status: "assigned" | "confirmed" | "declined" | "no_show"
      change_request_kind: "substitution" | "hours"
      change_request_status: "pending" | "approved" | "rejected" | "withdrawn"
      employment_type: "fisso" | "a_chiamata"
      message_kind:
        | "text"
        | "shift_change_request"
        | "shift_change_response"
        | "absence_request"
        | "absence_response"
      notification_type:
        | "application_received"
        | "application_accepted"
        | "application_rejected"
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
      shift_kind: "marketplace" | "internal"
      shift_status: "open" | "closed" | "cancelled"
      staff_link_status: "pending" | "active" | "left"
      user_role: "waiter" | "manager"
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
    Enums: {
      absence_kind: ["ferie", "permesso", "malattia"],
      absence_status: ["pending", "approved", "rejected", "withdrawn"],
      application_status: ["pending", "accepted", "rejected", "cancelled"],
      assignment_status: ["assigned", "confirmed", "declined", "no_show"],
      change_request_kind: ["substitution", "hours"],
      change_request_status: ["pending", "approved", "rejected", "withdrawn"],
      employment_type: ["fisso", "a_chiamata"],
      message_kind: [
        "text",
        "shift_change_request",
        "shift_change_response",
        "absence_request",
        "absence_response",
      ],
      notification_type: [
        "application_received",
        "application_accepted",
        "application_rejected",
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
      shift_kind: ["marketplace", "internal"],
      shift_status: ["open", "closed", "cancelled"],
      staff_link_status: ["pending", "active", "left"],
      user_role: ["waiter", "manager"],
    },
  },
} as const
