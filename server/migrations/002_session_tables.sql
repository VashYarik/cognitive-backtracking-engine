-- Slice 1 tables for a live class session (docs/slice1-design.md, section 4).

CREATE TABLE p1_wording (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text text NOT NULL CONSTRAINT p1_wording_text_unique UNIQUE
);

-- The starting P1 wording (spec 4.3). Each pulse stores which wording it used.
INSERT INTO p1_wording (text)
VALUES ('Could you explain the last idea to a classmate right now?');

CREATE TABLE class_session (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id bigint NOT NULL REFERENCES course (id),
  join_code text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  first_student_joined_at timestamptz,
  ended_at timestamptz,
  current_concept_id bigint,
  -- The current concept must belong to this session's course.
  -- While current_concept_id is empty, PostgreSQL skips this check.
  CONSTRAINT class_session_current_concept_in_course
    FOREIGN KEY (course_id, current_concept_id) REFERENCES concept (course_id, id)
);

-- A join code is unique among sessions that have not ended; an ended
-- session's code can be used again.
CREATE UNIQUE INDEX class_session_join_code_active ON class_session (join_code)
  WHERE ended_at IS NULL;

-- One row per joined student. Deleted at session end or 2 hours after the
-- first student joined (spec D24); the server does the deleting.
CREATE TABLE student_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_session_id bigint NOT NULL REFERENCES class_session (id),
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pulse (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_session_id bigint NOT NULL REFERENCES class_session (id),
  -- The concept the pulse was about (spec 4.9a).
  concept_id bigint NOT NULL REFERENCES concept (id),
  wording_id bigint NOT NULL REFERENCES p1_wording (id),
  joined_count integer NOT NULL
    CONSTRAINT pulse_joined_count_not_negative CHECK (joined_count >= 0),
  window_seconds integer NOT NULL
    CONSTRAINT pulse_window_range CHECK (window_seconds BETWEEN 15 AND 60),
  fired_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by text
    CONSTRAINT pulse_closed_by_values CHECK (closed_by IN ('timeout', 'all_answered', 'professor')),
  CONSTRAINT pulse_closed_together CHECK ((closed_at IS NULL) = (closed_by IS NULL))
);

-- A student's P1 and P2 for one pulse, in one row (design decision 1).
-- No timestamp column, so no response time can be worked out (spec section 5).
CREATE TABLE response (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pulse_id bigint NOT NULL REFERENCES pulse (id),
  -- When the student code is deleted, the answers stay and the link is emptied.
  student_session_id uuid REFERENCES student_session (id) ON DELETE SET NULL,
  p1 text CONSTRAINT response_p1_values CHECK (p1 IN ('yes', 'not_yet')),
  p2 smallint CONSTRAINT response_p2_range CHECK (p2 BETWEEN 1 AND 7),
  -- One row per student per pulse. Rows whose link was emptied do not
  -- clash with each other, because PostgreSQL treats empty values as distinct.
  CONSTRAINT response_one_per_student UNIQUE (pulse_id, student_session_id),
  -- A student who skips both questions leaves no row.
  CONSTRAINT response_has_answer CHECK (p1 IS NOT NULL OR p2 IS NOT NULL)
);

CREATE TABLE fracture_alert (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pulse_id bigint NOT NULL REFERENCES pulse (id)
    CONSTRAINT fracture_alert_one_per_pulse UNIQUE,
  rating_count integer NOT NULL
    CONSTRAINT fracture_alert_rating_count_not_negative CHECK (rating_count >= 0),
  lost_count integer NOT NULL
    CONSTRAINT fracture_alert_lost_count_not_negative CHECK (lost_count >= 0),
  -- The settings the fracture rule used for this alert (design decision 9).
  lost_cutoff integer NOT NULL
    CONSTRAINT fracture_alert_lost_cutoff_range CHECK (lost_cutoff BETWEEN 1 AND 7),
  alert_bar_percent integer NOT NULL
    CONSTRAINT fracture_alert_alert_bar_range CHECK (alert_bar_percent BETWEEN 1 AND 100),
  min_group_size integer NOT NULL
    CONSTRAINT fracture_alert_min_group_size_positive CHECK (min_group_size >= 1),
  -- The time of the live-number send (or pulse close) at which the rule was
  -- met, never the time of one rating (spec section 5, v1.5).
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fracture_alert_lost_within_ratings CHECK (lost_count <= rating_count)
);

-- Saved only when the professor taps "We walked back to [concept]" (spec 4.9).
CREATE TABLE walk_back (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_session_id bigint NOT NULL REFERENCES class_session (id),
  -- The concept walked back to (spec 4.9b).
  concept_id bigint NOT NULL REFERENCES concept (id),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
