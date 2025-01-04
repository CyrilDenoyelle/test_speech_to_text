
from faster_whisper import WhisperModel

# model_size = "distil-large-v2"

model_size = "large-v3"

# Run on GPU with FP16
model = WhisperModel(
    model_size,
    device="cuda",
    compute_type="float32",
    local_files_only=True,
    num_workers=3
)

# or run on GPU with INT8
# model = WhisperModel(model_size, device="cuda", compute_type="int8_float16")
# or run on CPU with INT8
# model = WhisperModel(model_size, device="cpu",
#  cpu_threads=12, compute_type="int8")
