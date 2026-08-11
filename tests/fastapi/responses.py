class Response:
    def __init__(self,content=None,status_code=200,media_type=None,headers=None):
        self.content=content; self.status_code=status_code; self.headers=headers or {}
class JSONResponse(Response):
    def __init__(self,content=None,status_code=200,**k):
        super().__init__(content,status_code); self.content=content
    def set_cookie(self,*a,**k): pass
    def delete_cookie(self,*a,**k): pass
class FileResponse(Response): pass
class RedirectResponse(Response): pass
