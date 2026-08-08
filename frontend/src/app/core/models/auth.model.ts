export interface User {
  id: string;
  email: string;
  full_name: string;
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
