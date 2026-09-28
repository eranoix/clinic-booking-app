import type { Calendar, DateException } from 'clinic-booking-app/availability';

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  hue: 'blue' | 'green' | 'ochre' | 'plum' | 'slate';
  active: boolean;
  calendar: Calendar;
}

export interface ServiceDef {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  stepMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
  active: boolean;
  staffIds: string[];
}

export interface SlotDTO {
  start: number;
  end: number;
  staffId: string;
  staffName: string;
}

export interface BookingDTO {
  id: number;
  token: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  customerName: string;
  customerEmail: string;
  startsAt: number;
  endsAt: number;
  status: 'confirmed' | 'cancelled';
  seriesId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ErrorCode = 'slot_taken' | 'not_offered' | 'not_found' | 'invalid' | 'cancelled' | 'unauthorized';

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    alternatives?: SlotDTO[];
  };
}

export interface ExceptionWithNote extends DateException {
  note: string;
}
