-- Database rules that need a small program, not just a table definition
-- (docs/slice1-design.md: tree checks in section 4, decisions 11, 12 and 13).
-- Every rejection uses error code check_violation and a rule name, so the
-- server and the tests can tell exactly which rule refused a change.
--
-- When a table has several BEFORE triggers, PostgreSQL runs them in name order.
-- The numbers in the trigger names (10, 20) fix that order: the session lock
-- is checked first, then the tree rules.


-- 1. Tree locked during a session (decision 13).
-- While a course has a session that has not ended, its concepts and
-- prerequisites cannot be inserted, changed or deleted.
CREATE FUNCTION reject_tree_edit_during_session() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  touched_course bigint;
BEGIN
  -- An UPDATE can move a row to another course, so both courses are checked.
  -- (For an INSERT, OLD is empty; for a DELETE, NEW is empty.)
  FOR touched_course IN
    SELECT DISTINCT id FROM unnest(ARRAY[OLD.course_id, NEW.course_id]) AS t (id)
    WHERE id IS NOT NULL
  LOOP
    -- Lock the course row. A session start locks the same row, so a tree edit
    -- and a session start for one course can never happen at the same moment.
    PERFORM 1 FROM course WHERE id = touched_course FOR UPDATE;

    IF EXISTS (
      SELECT 1 FROM class_session WHERE course_id = touched_course AND ended_at IS NULL
    ) THEN
      RAISE EXCEPTION 'The concept tree cannot be edited while a session is active.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tree_locked_during_session',
              TABLE = TG_TABLE_NAME;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER concept_10_tree_lock
  BEFORE INSERT OR UPDATE OR DELETE ON concept
  FOR EACH ROW EXECUTE FUNCTION reject_tree_edit_during_session();

CREATE TRIGGER prerequisite_10_tree_lock
  BEFORE INSERT OR UPDATE OR DELETE ON prerequisite
  FOR EACH ROW EXECUTE FUNCTION reject_tree_edit_during_session();


-- 2. Prerequisite links: no prerequisite on the root, and no loops (design section 4).
CREATE FUNCTION check_prerequisite_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Lock the course row so two links added at the same moment are checked one
  -- after the other; otherwise each could pass alone and together form a loop.
  PERFORM 1 FROM course WHERE id = NEW.course_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM concept WHERE id = NEW.concept_id AND is_root) THEN
    RAISE EXCEPTION 'The root concept cannot have a prerequisite.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'prerequisite_not_on_root',
            TABLE = 'prerequisite';
  END IF;

  -- The new link says "concept_id needs prerequisite_id". It closes a loop if
  -- prerequisite_id already leads back to concept_id. Walk from prerequisite_id
  -- through its prerequisites, their prerequisites, and so on.
  -- On an UPDATE the old version of this link is left out, because it is being
  -- replaced. (A link from a concept to itself is left to prerequisite_not_self.)
  IF EXISTS (
    WITH RECURSIVE reachable (id) AS (
      SELECT p.prerequisite_id
      FROM prerequisite p
      WHERE p.concept_id = NEW.prerequisite_id
        AND NOT (TG_OP = 'UPDATE'
                 AND p.concept_id = OLD.concept_id AND p.prerequisite_id = OLD.prerequisite_id)
      UNION
      SELECT p.prerequisite_id
      FROM prerequisite p
      JOIN reachable r ON p.concept_id = r.id
      WHERE NOT (TG_OP = 'UPDATE'
                 AND p.concept_id = OLD.concept_id AND p.prerequisite_id = OLD.prerequisite_id)
    )
    SELECT 1 FROM reachable WHERE id = NEW.concept_id
  ) THEN
    RAISE EXCEPTION 'This prerequisite link would create a loop.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'prerequisite_no_loop',
            TABLE = 'prerequisite';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prerequisite_20_link_check
  BEFORE INSERT OR UPDATE ON prerequisite
  FOR EACH ROW EXECUTE FUNCTION check_prerequisite_link();


-- 3. A concept that has prerequisites cannot be made the root. Without this,
-- the rule above could be bypassed by changing is_root afterwards.
CREATE FUNCTION check_concept_root() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_root AND EXISTS (SELECT 1 FROM prerequisite WHERE concept_id = NEW.id) THEN
    RAISE EXCEPTION 'A concept that has prerequisites cannot be the root.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'concept_root_has_no_prerequisites',
            TABLE = 'concept';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER concept_20_root_check
  BEFORE UPDATE ON concept
  FOR EACH ROW EXECUTE FUNCTION check_concept_root();


-- 4. Any edit to a concept or prerequisite removes the tree's approval (decision 11).
-- Runs AFTER the change is saved; only the server sets tree_approved back to true,
-- after the tree checks pass.
CREATE FUNCTION reset_tree_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE course SET tree_approved = false
  WHERE id IN (OLD.course_id, NEW.course_id) AND tree_approved;
  RETURN NULL; -- the return value of an AFTER trigger is not used
END;
$$;

CREATE TRIGGER concept_reset_approval
  AFTER INSERT OR UPDATE OR DELETE ON concept
  FOR EACH ROW EXECUTE FUNCTION reset_tree_approval();

CREATE TRIGGER prerequisite_reset_approval
  AFTER INSERT OR UPDATE OR DELETE ON prerequisite
  FOR EACH ROW EXECUTE FUNCTION reset_tree_approval();


-- 5. A session can be created only from an approved tree (decision 11).
CREATE FUNCTION require_approved_tree() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  approved boolean;
BEGIN
  -- The same row lock as in rule 1 (see there).
  SELECT tree_approved INTO approved FROM course WHERE id = NEW.course_id FOR UPDATE;
  IF approved IS NOT TRUE THEN
    RAISE EXCEPTION 'A session can only be started from an approved concept tree.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'class_session_requires_approved_tree',
            TABLE = 'class_session';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER class_session_require_approved_tree
  BEFORE INSERT ON class_session
  FOR EACH ROW EXECUTE FUNCTION require_approved_tree();


-- 6. A pulse's and a walk-back's concept must belong to the session's course
-- (decision 12). pulse and walk_back have no course_id, so a foreign key cannot
-- check this; the course is found through class_session.
CREATE FUNCTION check_concept_in_session_course() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM concept c
    JOIN class_session s ON s.course_id = c.course_id
    WHERE c.id = NEW.concept_id AND s.id = NEW.class_session_id
  ) THEN
    RAISE EXCEPTION 'The concept does not belong to this session''s course.'
      USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_concept_in_course',
            TABLE = TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pulse_concept_in_course
  BEFORE INSERT OR UPDATE ON pulse
  FOR EACH ROW EXECUTE FUNCTION check_concept_in_session_course();

CREATE TRIGGER walk_back_concept_in_course
  BEFORE INSERT OR UPDATE ON walk_back
  FOR EACH ROW EXECUTE FUNCTION check_concept_in_session_course();
