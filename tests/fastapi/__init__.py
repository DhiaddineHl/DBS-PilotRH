class _Dec:
    def __call__(self, *a, **k):
        def deco(fn): return fn
        return deco
class FastAPI:
    def __init__(self,**k): self.routes=[]
    def _reg(self,method):
        def outer(path,**kw):
            def deco(fn):
                self.routes.append((method,path,fn)); return fn
            return deco
        return outer
    def __getattr__(self,name):
        if name in ('get','post','put','delete','patch'): return self._reg(name)
        raise AttributeError(name)
    def middleware(self,kind):
        def deco(fn): return fn
        return deco
    def exception_handler(self,exc):
        def deco(fn): return fn
        return deco
    def mount(self,*a,**k): pass
class UploadFile: pass
def File(*a,**k): return None
def Form(default=None,**k): return default
def Query(default=None,**k): return default
class Request: pass
