class AsyncClient:
    def __init__(self,**k): pass
    async def __aenter__(self): return self
    async def __aexit__(self,*a): return False
    async def post(self,*a,**k): raise RuntimeError("stub")
