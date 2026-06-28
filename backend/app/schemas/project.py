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


class TemplateResponse(ProjectResponse):
    """模板响应（继承 ProjectResponse + 模板字段）"""
    is_template: bool
    template_category: str | None
    template_tags: list | None


class TemplatePublishRequest(BaseModel):
    """发布为模板的请求体"""
    category: str
    tags: list[str] = []
