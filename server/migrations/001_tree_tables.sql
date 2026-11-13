-- Slice 1 tables for the professor and the concept tree (docs/slice1-design.md, section 4).
-- Triggers (loop check, approval reset) come in a later migration.

CREATE TABLE professor (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CONSTRAINT professor_email_unique UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Settings live here with defaults, so every threshold is a stored value,
-- not a constant in the code (design decision 4).
CREATE TABLE course (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professor_id bigint NOT NULL REFERENCES professor (id),
  name text NOT NULL,
  window_seconds integer NOT NULL DEFAULT 25
    CONSTRAINT course_window_range CHECK (window_seconds BETWEEN 15 AND 60),
  lost_cutoff_ordinary integer NOT NULL DEFAULT 3
    CONSTRAINT course_lost_cutoff_ordinary_range CHECK (lost_cutoff_ordinary BETWEEN 1 AND 7),
  lost_cutoff_critical integer NOT NULL DEFAULT 5
    CONSTRAINT course_lost_cutoff_critical_range CHECK (lost_cutoff_critical BETWEEN 1 AND 7),
  alert_bar_percent integer NOT NULL DEFAULT 25
    CONSTRAINT course_alert_bar_range CHECK (alert_bar_percent BETWEEN 1 AND 100),
  min_group_size integer NOT NULL DEFAULT 3
    CONSTRAINT course_min_group_size_positive CHECK (min_group_size >= 1),
  live_update_seconds integer NOT NULL DEFAULT 5
    CONSTRAINT course_live_update_positive CHECK (live_update_seconds >= 1),
  -- Set to true only by the server after the tree checks pass.
  tree_approved boolean NOT NULL DEFAULT false
);

CREATE TABLE concept (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES course (id),
  title text NOT NULL,
  is_root boolean NOT NULL DEFAULT false,
  -- Unmarked counts as ordinary (spec D18).
  is_critical boolean NOT NULL DEFAULT false,
  -- Lets other tables point at (course_id, id), which proves a concept
  -- belongs to a given course.
  CONSTRAINT concept_course_id_id_unique UNIQUE (course_id, id)
);

-- At most one root per course: unique course_id, counting root rows only.
CREATE UNIQUE INDEX concept_one_root_per_course ON concept (course_id) WHERE is_root;

-- "concept_id needs prerequisite_id first." No explanation text (spec section 3).
CREATE TABLE prerequisite (
  course_id bigint NOT NULL,
  concept_id bigint NOT NULL,
  prerequisite_id bigint NOT NULL,
  PRIMARY KEY (concept_id, prerequisite_id),
  CONSTRAINT prerequisite_not_self CHECK (concept_id <> prerequisite_id),
  -- Both ends must be concepts of the same course.
  CONSTRAINT prerequisite_concept_in_course
    FOREIGN KEY (course_id, concept_id) REFERENCES concept (course_id, id),
  CONSTRAINT prerequisite_prerequisite_in_course
    FOREIGN KEY (course_id, prerequisite_id) REFERENCES concept (course_id, id)
);
