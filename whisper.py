import time
import sys
from whisperModel import model


filePath = sys.argv[1]
fileName = sys.argv[2]

start = time.time()

# segments, info = model.transcribe(
#     './' + filePath + '/' + fileName, beam_size=5, language="fr"
#     )

segments, info = model.transcribe(
    './' + filePath + '/' + fileName,
    # options
    beam_size=5,
    language="fr",
    temperature=0,
    no_repeat_ngram_size=1,
    hallucination_silence_threshold=0.25,
)

# print("Detected language '%s' with probability %f" %
#       (info.language, info.language_probability))

# txtfile = open("./transcriptions/%s.txt" % fileName, 'w')

for segment in segments:
    print(segment.text)
    sys.stdout.flush()
    # txtfile.write(segment.text + '\n')
    # txtfile.write("[%.2fs -> %.2fs] %s \n" %
    #               (segment.start, segment.end, segment.text))

# txtfile.close()
# exit process to free memory
sys.exit()
