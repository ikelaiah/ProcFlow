CREATE OR ALTER PROCEDURE dbo.v110_demo
AS
BEGIN
    SET NOCOUNT ON;

    -- Nested CREATE TABLE inside the procedure body.
    -- Before the fix this was mis-detected as a second top-level object,
    -- truncating the pasted SQL and forcing a manual object pick.
    CREATE TABLE #Stage (Id INT, Name NVARCHAR(100));

    BEGIN TRY
        UPDATE dbo.Source SET Synced = 1 WHERE Synced = 0;

        EXEC dbo.LoadStudent @StudentId;

        INSERT INTO #Stage (Id, Name)
        SELECT Id, Name FROM dbo.Student WHERE Active = 1;

        IF @@ROWCOUNT = 0
            THROW 51000, 'No students found', 1;
    END TRY
    BEGIN CATCH
        INSERT INTO dbo.ErrorLog(ErrorNumber, ErrorMessage)
        VALUES (ERROR_NUMBER(), ERROR_MESSAGE());
        THROW;
    END CATCH;

    SELECT Id, Name FROM #Stage ORDER BY Name;
END