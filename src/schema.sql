PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  data_class TEXT NOT NULL CHECK (data_class IN ('learner', 'test_fixture')),
  verified_teacher INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  education_level TEXT,
  institution TEXT NOT NULL DEFAULT '',
  explanation_depth TEXT NOT NULL DEFAULT 'intermediate',
  formats_json TEXT NOT NULL DEFAULT '[]',
  accessibility_json TEXT NOT NULL DEFAULT '{}',
  language TEXT NOT NULL DEFAULT '',
  offline_consent INTEGER NOT NULL DEFAULT 0,
  available_hours_per_week REAL,
  self_reported_confidence TEXT NOT NULL DEFAULT '',
  goals_text TEXT NOT NULL DEFAULT '',
  exam_syllabus_text TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  onboarding_status TEXT NOT NULL DEFAULT 'pending',
  age_band TEXT,
  parent_contact_verified INTEGER NOT NULL DEFAULT 0,
  dev_mailbox_simulated_at TEXT,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject_name TEXT NOT NULL DEFAULT '',
  goal_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  self_reported_level TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  topic_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  topic_id TEXT,
  source_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  label TEXT NOT NULL,
  depth TEXT,
  status TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  topic_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  paused_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  topic_id TEXT,
  artifact_id TEXT,
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  topic_id TEXT,
  source_id TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id TEXT,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  label TEXT NOT NULL,
  due_at TEXT,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS card_reviews (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quality INTEGER NOT NULL,
  scoring_method TEXT NOT NULL,
  revealed INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  ease REAL NOT NULL,
  scheduler TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  topic_id TEXT,
  source_id TEXT,
  prompt TEXT NOT NULL,
  choices_json TEXT NOT NULL,
  correct_index INTEGER,
  explanation TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  topic_id TEXT,
  kind TEXT NOT NULL,
  timing_mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  interrupted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  score_correct INTEGER,
  score_total INTEGER,
  scoring_method TEXT NOT NULL,
  client_token TEXT NOT NULL,
  UNIQUE (user_id, client_token)
);

CREATE TABLE IF NOT EXISTS attempt_answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_index INTEGER,
  correct INTEGER,
  feedback TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  topic_id TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL,
  routing_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  title TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  available_hours REAL NOT NULL,
  syllabus_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS circles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  invite_code TEXT,
  creator_kind TEXT NOT NULL DEFAULT 'learner',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);

CREATE TABLE IF NOT EXISTS circle_posts (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  audience_json TEXT NOT NULL,
  ack_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_cache (
  video_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_saved (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'playlist')),
  resource_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_metadata (
  kind TEXT NOT NULL CHECK (kind IN ('video', 'playlist')),
  resource_id TEXT NOT NULL,
  title TEXT,
  channel TEXT,
  thumbnail_url TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (kind, resource_id)
);

CREATE TABLE IF NOT EXISTS video_bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  course_id TEXT,
  topic_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  completion TEXT NOT NULL DEFAULT 'not_recorded',
  created_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookmark_id TEXT NOT NULL REFERENCES video_bookmarks(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  provenance TEXT NOT NULL,
  rights_confirmed INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  academic_verification TEXT NOT NULL DEFAULT 'not_verified',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS misconception_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT,
  question_id TEXT,
  status TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_event_id TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_provider TEXT,
  preferred_model TEXT,
  auto_select INTEGER NOT NULL DEFAULT 1,
  speed TEXT NOT NULL DEFAULT 'balanced',
  reasoning TEXT NOT NULL DEFAULT 'standard',
  cost_mode TEXT NOT NULL DEFAULT 'unknown_cost_allowed',
  multimodal INTEGER NOT NULL DEFAULT 0,
  independent_check INTEGER NOT NULL DEFAULT 0,
  residency TEXT NOT NULL DEFAULT 'unspecified',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS privacy_grants (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider, purpose)
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  mime TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT,
  model TEXT,
  state TEXT NOT NULL,
  billing_note TEXT NOT NULL,
  task TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS lab_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT,
  topic_id TEXT,
  lab TEXT NOT NULL,
  params_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  assumptions TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  learning_claim TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS autopilot_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diff_json TEXT NOT NULL,
  conflicts_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_rev INTEGER,
  result TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_courses_user ON courses(user_id);
CREATE INDEX IF NOT EXISTS idx_topics_user ON topics(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON video_bookmarks(user_id);

CREATE TABLE IF NOT EXISTS schedule_previews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS parent_guardians (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parent_sessions (
  token_hash TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parent_guardians(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parent_links (
  parent_id TEXT NOT NULL REFERENCES parent_guardians(id) ON DELETE CASCADE,
  child_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_user_id)
);

CREATE TABLE IF NOT EXISTS consent_tokens (
  id TEXT PRIMARY KEY,
  child_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  parent_email TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_log (
  id TEXT PRIMARY KEY,
  child_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  method TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  event TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_reports (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_blocks (
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_at TEXT NOT NULL,
  PRIMARY KEY (circle_id, user_id)
);

CREATE TABLE IF NOT EXISTS circle_dms (
  id TEXT PRIMARY KEY,
  circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  watched_at TEXT NOT NULL
);
