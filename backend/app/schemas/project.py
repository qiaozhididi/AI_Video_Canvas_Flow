"""项目 Pydantic Schema"""

from datetime import datetime

from pydantic import BaseModel


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str | None
    cover_url: str | None = None
    owner_id: str
    created_at: datetime
    updated_at: datetime
