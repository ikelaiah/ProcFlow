/*
    v1.10.0 demo — column lineage foundations.

    This script exercises the v1.10.0 territory (ROADMAP v1.10.0) in one
    script: column scopes and bindings for qualified references, aliases,
    projections, CTEs, derived tables, and catalogue-backed wildcard
    expansion; expression-level provenance within one query statement; and
    explicit ambiguous and opaque column references.

    Every query-bearing SELECT statement is now analysed at column level.
    The findings panel reports region-scoped diagnostics only when a binding
    cannot be proven:

      1. Ambiguous — "SELECT StudentName FROM dbo.Student s JOIN dbo.Course c
         ON ..." with no qualifier matches several sources; no binding is
         invented (column_ambiguous).
      2. Opaque — a scalar subquery projection cannot be resolved at column
         level in this release (column_opaque).

    To see catalogue-backed wildcard expansion, paste this catalogue in the
    Catalogue menu and Apply it, then re-run:

       dbo.Student TABLE student
       dbo.Course TABLE
       COL dbo.Student.StudentId
       COL dbo.Student.StudentName
       COL dbo.Student.EnrolmentYear
       COL dbo.Course.CourseId
       COL dbo.Course.CourseName

    Now "SELECT s.* FROM dbo.Student s" expands to the catalogue's provable
    columns (StudentId, StudentName, EnrolmentYear), each bound exactly to
    its input column with its source span. Without catalogue evidence the
    wildcard stays unexpanded and never invents columns.

    Multi-statement temporary-table column flow, inter-object column flow,
    and the column export contract remain on the roadmap (v1.11.0).

    This demo is an illustration, not an input to the fixture-corpus metrics
    (docs/metrics-v1.10.0.json). No user input or runtime telemetry is
    collected.
*/
CREATE VIEW dbo.v1100_student_courses AS
-- CTE scope: the explicit column list (StudentId, StudentName, CourseName)
-- is carried through, and each projected column binds to its exact input.
WITH detail(StudentId, StudentName, CourseName) AS (
    SELECT s.StudentId, s.StudentName, c.CourseName
    FROM dbo.Student s
    JOIN dbo.Course c ON c.CourseId = s.CourseId
)
SELECT d.StudentId, d.StudentName, d.CourseName
FROM detail d;

GO

CREATE PROCEDURE dbo.v1100_column_lineage @Year INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Qualified references and aliases bind exactly, with spans.
    SELECT s.StudentId AS StudentNumber,
           s.StudentName AS StudentName
    FROM dbo.Student s
    WHERE s.EnrolmentYear = @Year;

    -- Expression-level provenance: FullName maps back to both input columns.
    SELECT s.FirstName + N' ' + s.LastName AS FullName
    FROM dbo.Student s;

    -- Derived-table scope: x exposes exactly the inner projection's columns.
    SELECT x.StudentId, x.EnrolmentYear
    FROM (SELECT StudentId, EnrolmentYear FROM dbo.Student) x;

    -- Ambiguous: an unqualified column that matches several sources is left
    -- unresolved with a region-scoped column_ambiguous diagnostic. No binding
    -- is invented.
    SELECT StudentId
    FROM dbo.Student s
    JOIN dbo.Course c ON c.CourseId = s.CourseId;

    -- Opaque: the scalar subquery cannot be resolved at column level in this
    -- release; its projection is marked opaque with a column_opaque
    -- diagnostic. The rest of the statement still binds.
    SELECT s.StudentName,
           (SELECT MAX(AuditId) FROM dbo.v1100_audit) AS LastAuditId
    FROM dbo.Student s;

    -- Catalogue-backed wildcard expansion (paste the catalogue above): with
    -- the catalogue applied, s.* expands to the provable columns, each bound
    -- exactly. Without it, the wildcard stays unexpanded.
    SELECT s.*
    FROM dbo.Student s;

    RETURN 0;
END;

GO

CREATE PROCEDURE dbo.v1100_audit
AS
BEGIN
    SELECT COUNT(*) AS Total FROM dbo.Student;
END;
