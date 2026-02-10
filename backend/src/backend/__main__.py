"""convenience runner: `python -m backend`."""

import uvicorn

uvicorn.run("backend.main:app", reload=True)
