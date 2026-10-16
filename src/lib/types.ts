export interface Room { id: string; invite_code: string; title: string; owner_id: string; active_sharer: string | null; lease_until: string | null; closed: boolean; expires_at: string; }
export interface Member { user_id: string; display_name: string; requested: boolean; last_seen: string; }
export interface ChatMessage { id: number; sender_id: string; body: string; created_at: string; }
export interface Snapshot { room: Room; members: Member[]; messages: ChatMessage[]; }
export interface Signal { id: number; room_id: string; sender_id: string; receiver_id: string; payload: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; media?: { mic: boolean; camera: boolean }; hello?: boolean; }; created_at: string; }
