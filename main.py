
import joblib
import pandas as pd
import traceback

from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Literal
from fastapi.middleware.cors import CORSMiddleware

# Load the model from the same folder as main.py
BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "Mental_Health_Model.pkl"

model = joblib.load(MODEL_PATH)

top_countries = [
    "Other", "India", "USA", "Canada", "Australia",
    "UK", "Germany", "Mexico", "Turkey", "France"
]

app = FastAPI(title="Mental Health Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class StudentData(BaseModel):
    age: int = Field(..., ge=10, le=100)
    gender: Literal["Male", "Female"]
    country: str
    academic_level: Literal["Undergraduate", "Graduate", "High School"]
    most_used_platform: Literal["Facebook", "LinkedIn", "Instagram", "Snapchat","Twitter", "YouTube", "TikTok", "LINE",
        "KakaoTalk", "VKontakte", "WhatsApp", "WeChat"]
    purpose_of_use: Literal["Networking", "Education", "Entertainment", "News"]
    avg_daily_usage_hours: float = Field(..., ge=0, le=24)
    daily_unlocks: int = Field(..., ge=0)
    study_hours: float = Field(..., ge=0, le=24)
    physical_activity_hours: float = Field(..., ge=0, le=24)
    sleep_hours_per_night: float = Field(..., ge=0, le=24)
    stress_level: Literal["Medium", "Low", "Very High", "High"]


class PredictionResponse(BaseModel):
    predicted_mental_health_score: float


@app.get("/")
def greet():
    return {"message": "Mental Health Prediction API is running"}


@app.post("/predict", response_model=PredictionResponse)
def predict(data: StudentData):
    try:
        country_group = (
            data.country
            if data.country in top_countries
            else "Other"
        )

        input_row = pd.DataFrame([{
            "Age": data.age,
            "Gender": data.gender,
            "Country": data.country,
            "Academic_Level": data.academic_level,
            "Most_Used_Platform": data.most_used_platform,
            "Purpose_Of_Use": data.purpose_of_use,
            "Avg_Daily_Usage_Hours": data.avg_daily_usage_hours,
            "Daily_Unlocks": data.daily_unlocks,
            "Study_Hours": data.study_hours,
            "Physical_Activity_Hours": data.physical_activity_hours,
            "Sleep_Hours_Per_Night": data.sleep_hours_per_night,
            "Stress_Level": data.stress_level,
            "Grouped_countries": country_group
        }])

        print("Input columns:", input_row.columns.tolist())

        expected = getattr(model, "feature_names_in_", None)
        if expected is not None:
            print("Expected model columns:", list(expected))

        prediction = model.predict(input_row)[0]
        print("Raw prediction:", repr(prediction))

        return PredictionResponse(
            predicted_mental_health_score=float(prediction)
        )

    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(exc)}"
        ) from exc
