export interface User {
  id: string;
  email: string;
  full_name: string;
  email_verified: boolean;
}

/** A bare acknowledgement, used where the API deliberately says nothing more. */
export interface MessageResponse {
  message: string;
}

/** What the server supports, so the UI only offers what will actually work. */
export interface AuthProviders {
  google_client_id: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string;
}

export interface AuthResponse {
  user: User;
  tokens: TokenPair;
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  tags: string[];
  accent: string;
  accent_presets: string[];
  ats_safe: boolean;
  sidebar_sections: string[];
  page_margin: string;
}
