/*
    v1.2.0 demo — trust statement boundaries.

    The four objects below exercise the v1.2.0 boundary-handling outcomes
    directly. Open the file in ProcFlow, set Scope to Object dependencies to
    see the three objects, then switch to Internal logic for each.

    1. Semicolon-free statement boundaries are grammar-driven, not
       newline-driven. The one-line block in dbo.v120_demo has NO semicolons
       and no newlines between statements; v1.2.0 splits it on control
       keywords (SET / PRINT / SELECT) instead of collapsing it into one
       statement.
    2. Semicolons remain authoritative whenever they are present.
    3. Number lexing: 0x hex literals, 1_000 digit separators, and the
       1. / .5 fractional forms are single numeric tokens.
    4. findBody handles CREATE VIEW ... WITH (...) AS headers, so the view
       body is extracted correctly.
    5. Multi-object scripts split into separate objects with no GO separator.
*/
CREATE OR ALTER PROCEDURE dbo.v120_demo @Limit INT = 0x10
AS
BEGIN
    SET NOCOUNT ON;

    -- v1.2.0: three statements on ONE line with NO semicolons and NO
    -- newlines. Prior to v1.2.0 these ran together as a single statement.
    SET @Limit = 1_000 PRINT 'one-line, semicolon-free' SELECT @Limit AS limit;

    -- Numbers: 0x7FFF hex, 1_000_000 separators, .5 and 1. fractions.
    SELECT 0x7FFF AS hex_value,
           1_000_000 AS separated,
           .5 AS half,
           1. AS unit;

    -- Semicolons stay authoritative when present.
    IF @Limit < 0x10000
        SELECT 'small' AS range;
    ELSE
        SELECT 'large' AS range;

    BEGIN TRY
        EXEC dbo.v120_sink @Limit;
    END TRY
    BEGIN CATCH
        INSERT INTO dbo.ErrorLog(ErrorNumber, ErrorMessage)
        VALUES (ERROR_NUMBER(), ERROR_MESSAGE());
        THROW;
    END CATCH;
END;

CREATE PROCEDURE dbo.v120_sink @Amount BIGINT
AS
BEGIN
    UPDATE dbo.Account SET Balance = Balance + @Amount WHERE Active = 1;
    SELECT @@ROWCOUNT AS rows_changed;
END;

CREATE VIEW dbo.v120_snapshot WITH SCHEMABINDING
AS
    SELECT Id, Price
    FROM dbo.Account
    WHERE Price >= .5;
