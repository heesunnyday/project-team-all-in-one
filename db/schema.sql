BEGIN;

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  owner text NOT NULL CHECK (length(btrim(owner)) BETWEEN 1 AND 200),
  date date NOT NULL CHECK (date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  owner text NOT NULL CHECK (length(btrim(owner)) BETWEEN 1 AND 200),
  date date CHECK (date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  done boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author text NOT NULL CHECK (length(btrim(author)) BETWEEN 1 AND 200),
  owner text NOT NULL CHECK (length(btrim(owner)) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT '미완료' CHECK (status IN ('미완료', '작업 중', '완료')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_date_idx ON events (date);
CREATE INDEX IF NOT EXISTS todos_date_idx ON todos (date);
COMMIT;
