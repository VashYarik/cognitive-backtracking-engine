-- The goal concept (spec v1.6, 3.6 and 4.15; docs/slice1-design.md decision 14).
-- The goal is the concept a course builds towards. Its scope is the goal and
-- every concept it builds on. In a session, only scope concepts can be used.

ALTER TABLE concept ADD COLUMN is_goal boolean NOT NULL DEFAULT false;

-- At most one goal per course. "Exactly one" is checked by the server's tree
-- checks at Approve, because a tree that is still being built may have no goal yet.
CREATE UNIQUE INDEX concept_one_goal_per_course ON concept (course_id) WHERE is_goal;


-- True if the concept is in the goal's scope for this course: the goal itself,
-- its prerequisites, their prerequisites, and so on. False if the course has no goal.
CREATE FUNCTION concept_in_goal_scope(target_course bigint, target_concept bigint)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE scope (id) AS (
    SELECT id FROM concept WHERE course_id = target_course AND is_goal
    UNION
    SELECT p.prerequisite_id
    FROM prerequisite p
    JOIN scope s ON p.concept_id = s.id
  )
  SELECT EXISTS (SELECT 1 FROM scope WHERE id = target_concept);
$$;


-- The session's current concept must be in the goal's scope.
CREATE FUNCTION check_current_concept_in_goal_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_concept_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- A concept of another course is left to the foreign key
  -- class_session_current_concept_in_course, which reports it under its own name.
  IF NOT EXISTS (
    SELECT 1 FROM concept WHERE id = NEW.current_concept_id AND course_id = NEW.course_id
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT concept_in_goal_scope(NEW.course_id, NEW.current_concept_id) THEN
    RAISE EXCEPTION 'In a session, only the goal and the concepts it builds on can be used.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'class_session_concept_in_goal_scope',
            TABLE = 'class_session';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger names decide the order of BEFORE triggers on a table (name order).
-- "scope_check" sorts after "require_approved_tree", so a session from an
-- unapproved tree still reports that rule first.
CREATE TRIGGER class_session_scope_check
  BEFORE INSERT OR UPDATE OF current_concept_id ON class_session
  FOR EACH ROW EXECUTE FUNCTION check_current_concept_in_goal_scope();


-- A pulse's or walk-back's concept must be in the goal's scope.
CREATE FUNCTION check_concept_in_goal_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  session_course bigint;
BEGIN
  SELECT course_id INTO session_course FROM class_session WHERE id = NEW.class_session_id;
  IF NOT concept_in_goal_scope(session_course, NEW.concept_id) THEN
    RAISE EXCEPTION 'In a session, only the goal and the concepts it builds on can be used.'
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_concept_in_goal_scope',
            TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

-- "scope_check" sorts after "concept_in_course" (migration 003), so a concept
-- of another course still reports the course rule first.
CREATE TRIGGER pulse_scope_check
  BEFORE INSERT OR UPDATE ON pulse
  FOR EACH ROW EXECUTE FUNCTION check_concept_in_goal_scope();

CREATE TRIGGER walk_back_scope_check
  BEFORE INSERT OR UPDATE ON walk_back
  FOR EACH ROW EXECUTE FUNCTION check_concept_in_goal_scope();
