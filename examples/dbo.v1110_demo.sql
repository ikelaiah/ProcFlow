/*
    v1.11.0 demo — column lineage pipelines.

    This script exercises the v1.11.0 territory (ROADMAP v1.11.0) in one
    script: column-flow edges through temporary tables, transformations,
    views, CTEs, and catalogue-resolved object boundaries. Every produced
    column is traced end-to-end to its original source object, and an
    ambiguous reaching definition (a conditional write or branch merge) stays
    opaque with a region-scoped column_flow_opaque diagnostic — no binding is
    ever invented.

    What to observe in the "Constructs" panel: a `column_flow` row reports how
    many column-carrying objects and column-flow edges were detected,
    resolved, and left opaque. The column-flow graph exports to Mermaid and
    draw.io with provenance metadata and is laid out on its own documented
    `column` graph class.

      1. dbo.v1110_pipeline — SELECT … INTO #stage from dbo.Student, an UPDATE
         transformation, then a final SELECT. #stage.id and #stage.name trace
         all the way back to dbo.Student.id / dbo.Student.name.
      2. dbo.v1110_branch — an IF/ELSE where both branches write #t, so the
         later SELECT FROM #t reads an ambiguous reaching definition and
         stays opaque. No producer→consumer edge is drawn.
      3. dbo.v1110_uses_view — consumes dbo.v1110_student_view, whose columns
         were defined earlier in this same script, resolving the object
         boundary by definition instead of staying external.

    The view object that this pipeline consumes is defined below first:

       CREATE VIEW dbo.v1110_student_view AS
         SELECT StudentId, StudentName FROM dbo.Student;

    To resolve secondary dbo.* objects by catalogue evidence instead, paste
    this catalogue in the Catalogue menu and Apply, then re-run:

       dbo.Student TABLE student
       dbo.Course TABLE
       COL dbo.Student.StudentId
       COL dbo.Student.StudentName
       COL dbo.Course.CourseId

    Interactive column views in the app remain scheduled for v1.13.0.

    This demo is an illustration, not an input to the fixture-corpus metrics
    (docs/metrics-v1.11.0.json). No user input or runtime telemetry is
    collected.
*/
CREATE VIEW dbo.v1110_student_view AS
SELECT StudentId, StudentName
FROM dbo.Student;

GO

-- end-to-end: SELECT … INTO #t through an UPDATE transformation to outputs.
-- #stage.id and #stage.name trace to dbo.Student columns exactly.
CREATE PROCEDURE dbo.v1110_pipeline
AS
BEGIN
    SET NOCOUNT ON;

    SELECT StudentId, StudentName
    INTO #stage
    FROM dbo.Student;

    UPDATE #stage
    SET StudentId = StudentId + 1000;

    SELECT StudentId, StudentName
    FROM #stage;

    RETURN 0;
END;

GO

-- ambiguous reaching definition: both branches write #t, so the consumer
-- after them stays opaque with a column_flow_opaque diagnostic.
CREATE PROCEDURE dbo.v1110_branch @UseArchive BIT
AS
BEGIN
    SET NOCOUNT ON;

    IF @UseArchive = 1
        SELECT StudentId INTO #t FROM dbo.StudentArchive;
    ELSE
        SELECT StudentId, StudentName INTO #t FROM dbo.Student;

    SELECT StudentId FROM #t;

    RETURN 0;
END;

GO

-- object boundary: the view's columns were defined in this same script, so
-- the proc resolves dbo.v1110_student_view by definition and traces its
-- StudentId back to dbo.Student.
CREATE PROCEDURE dbo.v1110_uses_view
AS
BEGIN
    SET NOCOUNT ON;

    SELECT StudentId
    FROM dbo.v1110_student_view;

    RETURN 0;
END;

GO

CREATE PROCEDURE dbo.v1110_audit
AS
BEGIN
    SELECT COUNT(*) AS Total FROM dbo.Student;
END;
