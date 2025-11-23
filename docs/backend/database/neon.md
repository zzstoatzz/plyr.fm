# neon database configuration

configuration guide for connecting to neon postgres databases.

## overview

plyr.fm uses [neon](https://neon.tech) for all database environments (dev, staging, prod). neon uses a specialized proxy architecture that requires specific connection settings for security and reliability.

## connection string format

the connection string must use the **psycopg** driver and include specific ssl parameters.

### format
```bash
postgresql+psycopg://<user>:<password>@<host>/<dbname>?sslmode=require&channel_binding=require
```

### key components

1.  **driver**: `postgresql+psycopg://`
    - **required**: we must use the `psycopg` (v3) driver, not `asyncpg`.
    - **reason**: `asyncpg` does not support the `channel_binding` parameter, which is required for strict ssl verification with neon.

2.  **ssl mode**: `sslmode=require`
    - forces ssl encryption for the connection.

3.  **channel binding**: `channel_binding=require`
    - ensures the connection is not intercepted (mitm protection).
    - uses SCRAM-SHA-256-PLUS authentication.

## environment variables

set the `DATABASE_URL` in your `.env` file:

```bash
# development (example)
DATABASE_URL=postgresql+psycopg://<user>:<password>@<host>/<dbname>?sslmode=require&channel_binding=require
```

## troubleshooting

### typeerror: connect() got an unexpected keyword argument 'channel_binding'

**cause**: using `postgresql+asyncpg://` with `channel_binding=require`.
**fix**: change the scheme to `postgresql+psycopg://`.

### connection refused / ssl errors

**cause**: missing `sslmode=require` or `channel_binding=require`.
**fix**: ensure both parameters are present in the query string.

## references

- [neon documentation](https://neon.tech/docs)
- [sqlalchemy psycopg dialect](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#module-sqlalchemy.dialects.postgresql.psycopg)
