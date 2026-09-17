#!/usr/bin/env bash
# ponytail-review — in ra diff kèm checklist review theo tinh thần Ponytail.
# Đây KHÔNG phải công cụ tự chấm điểm; nó gom diff + checklist để bạn (hoặc agent) review.
# Dùng: scripts/ponytail-review.sh            # review diff đã staged
#       scripts/ponytail-review.sh --all      # review toàn bộ thay đổi so với HEAD
set -euo pipefail

range="--cached"
[ "${1:-}" = "--all" ] && range="HEAD"

diff="$(git diff $range)"
if [ -z "$diff" ]; then
  echo "Không có thay đổi để review (thử --all để xem cả unstaged)."
  exit 0
fi

echo "===== PONYTAIL REVIEW ====="
echo "$diff"
cat <<'EOF'

===== CHECKLIST (over-engineering) =====
Với mỗi thay đổi ở trên, dừng ở nấc thang đầu tiên đúng:
  1. Có cần tồn tại không? (YAGNI) — nếu không: xóa.
  2. Đã có sẵn trong codebase? — tái dùng, đừng viết lại.
  3. Thư viện chuẩn làm được? — dùng nó.
  4. Tính năng native của nền tảng lo được? — dùng nó.
  5. Dependency đã cài giải quyết được? — dùng nó.
  6. Có thể gói thành một dòng? — một dòng.
  7. Chỉ khi đó: viết lượng code tối thiểu chạy được.

KHÔNG cắt: validate ở biên tin cậy, xử lý lỗi tránh mất dữ liệu, bảo mật,
accessibility, và mọi thứ được yêu cầu rõ ràng.

Logic không tầm thường phải để lại ĐÚNG MỘT check chạy được.
EOF
