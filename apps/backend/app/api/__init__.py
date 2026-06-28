from fastapi import APIRouter

from app.api import auth, devices, services, system, tailscale, tasks, wol

router = APIRouter(prefix="/api")
router.include_router(auth.router)
router.include_router(system.router)
router.include_router(services.router)
router.include_router(devices.router)
router.include_router(tailscale.router)
router.include_router(wol.router)
router.include_router(tasks.router)
