from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import subprocess
import os

from app.core.database import get_db
from app.api.deps import require_authenticated_user
from app.models.user import User

router = APIRouter(prefix="/system", tags=["system"])


@router.post("/reset")
async def reset_application(
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db)
):
    """
    Reset the entire application to initial state.
    
    This endpoint:
    - Drops and recreates the database
    - Runs all migrations
    - Seeds initial data
    
    **ONLY accessible by users with FULL_ACCESS (Administrator) role.**
    This is a destructive operation and cannot be undone!
    """
    # Check if user is administrator (not just admin/manager)
    if not current_user.is_administrator():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can reset the application"
        )
    
    try:
        # Get the backend directory path
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        reset_script = os.path.join(backend_dir, "reset_application.py")
        
        # Check if reset script exists
        if not os.path.exists(reset_script):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Reset script not found"
            )
        
        # Run the reset script
        result = subprocess.run(
            ["python3", reset_script],
            cwd=backend_dir,
            capture_output=True,
            text=True,
            timeout=60  # 60 second timeout
        )
        
        if result.returncode != 0:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Reset failed: {result.stderr}"
            )
        
        return {
            "message": "Application reset successfully",
            "output": result.stdout
        }
        
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Reset operation timed out"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reset failed: {str(e)}"
        )
