from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthUser(BaseModel):
    id: int
    username: str
    is_admin: bool

    model_config = {"from_attributes": True}
