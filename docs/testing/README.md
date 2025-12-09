# testing

testing philosophy and infrastructure for plyr.fm.

## philosophy

### test behavior, not implementation

tests should verify *what* the code does, not *how* it does it. this makes tests resilient to refactoring and keeps them focused on user-facing behavior.

**good**: "when a user likes a track, the like count increases"
**bad**: "when `_increment_like_counter` is called, it executes `UPDATE tracks SET...`"

signs you're testing implementation:
- mocking internal functions that aren't boundaries
- asserting on SQL queries or ORM calls
- testing private methods directly
- tests break when you refactor without changing behavior

### test at the right level

- **unit tests**: pure functions, utilities, data transformations
- **integration tests**: API endpoints with real database
- **skip mocks when possible**: prefer real dependencies (postgres, redis) over mocks

### keep tests fast

slow tests don't get run. we use parallel execution (xdist) and template databases to keep the full suite under 30 seconds.

## parallel execution with xdist

we run tests in parallel using pytest-xdist. each worker gets its own isolated database.

### how it works

1. **template database**: first worker creates a template with all migrations applied
2. **clone per worker**: each xdist worker clones from template (`CREATE DATABASE ... WITH TEMPLATE`)
3. **instant setup**: cloning is a file copy - no migrations needed per worker
4. **advisory locks**: coordinate template creation between workers

this is a common pattern for fast parallel test execution in large codebases.

### the fixture chain

```
test_database_url (session)
    └── creates template db (once, with advisory lock)
    └── clones worker db from template
    └── patches settings.database.url for this worker

_database_setup (session)
    └── marker that db is ready

_engine (function)
    └── creates engine for test_database_url
    └── clears ENGINES cache

_clear_db (function)
    └── calls clear_database() procedure after each test

db_session (function)
    └── provides AsyncSession for test
```

### common pitfall: missing db_session dependency

if a test uses the FastAPI app but doesn't depend on `db_session`, the database URL won't be patched for the worker. the test will connect to the wrong database.

**wrong**:
```python
@pytest.fixture
def test_app() -> FastAPI:
    return app

async def test_something(test_app: FastAPI):
    # may connect to wrong database in xdist!
    ...
```

**right**:
```python
@pytest.fixture
def test_app(db_session: AsyncSession) -> FastAPI:
    _ = db_session  # ensures db fixtures run first
    return app

async def test_something(test_app: FastAPI):
    # database URL is correctly patched
    ...
```

## running tests

```bash
# from repo root
just backend test

# run specific test
just backend test tests/api/test_tracks.py

# run with coverage
just backend test --cov

# run single-threaded (debugging)
just backend test -n 0
```

## writing good tests

### do

- use descriptive test names that describe behavior
- one assertion per concept (multiple asserts ok if testing one behavior)
- use fixtures for setup, not test body
- test edge cases and error conditions
- add regression tests when fixing bugs

### don't

- use `@pytest.mark.asyncio` - we use `asyncio_mode = "auto"`
- mock database calls - use real postgres
- test ORM internals or SQL structure
- leave tests that depend on execution order
- skip tests instead of fixing them (unless truly environment-specific)

## when private function tests are acceptable

generally avoid testing private functions (`_foo`), but there are pragmatic exceptions:

**acceptable**:
- pure utility functions with complex logic (string parsing, data transformation)
- functions that are difficult to exercise through public API alone
- when the private function is a clear unit with stable interface

**not acceptable**:
- implementation details that might change (crypto internals, caching strategy)
- internal orchestration functions
- anything that's already exercised by integration tests

the key question: "if i refactor, will this test break even though behavior didn't change?"

## database fixtures

### clear_database procedure

instead of truncating tables between tests (slow), we use a stored procedure that deletes only rows created during the test:

```sql
CALL clear_database(:test_start_time)
```

this deletes rows where `created_at > test_start_time`, preserving any seed data.

### why not transactions?

rolling back transactions is faster, but:
- can't test commit behavior
- can't test constraints properly
- some ORMs behave differently in uncommitted transactions

delete-by-timestamp gives us real commits while staying fast.
