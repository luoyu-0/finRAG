"""稳定错误码与统一错误响应。"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status,
            content={"error_code": error.code, "message": error.message},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error_code": "VALIDATION_ERROR", "message": "请求字段无效"},
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(_request: Request, error: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"error_code": f"HTTP_{error.status_code}", "message": str(error.detail)},
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_request: Request, error: Exception) -> JSONResponse:
        logging.getLogger(__name__).error("请求处理失败", exc_info=error)
        return JSONResponse(
            status_code=500,
            content={"error_code": "INTERNAL_ERROR", "message": "服务暂不可用"},
        )
