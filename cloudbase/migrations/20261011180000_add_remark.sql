ALTER TABLE public.favorites ADD COLUMN IF NOT EXISTS remark text, ADD CONSTRAINT favorites_remark_len CHECK (remark IS NULL OR length(btrim(remark)) <= 500);
COMMENT ON COLUMN public.favorites.remark IS '用户给这条收藏写的备注（PATCH 可改；可空，≤500 字）';
