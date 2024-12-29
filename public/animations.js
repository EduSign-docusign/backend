// Initialize animations object first
window.appAnimations = {};

// Use the global Motion One library
const animate = window.Motion?.animate;

// Animate form field
function animateFormField(field, index) {
  if (!animate) return; // Safely handle missing animation library

  animate(
    field,
    {
      opacity: [0, 1],
      x: [-20, 0],
    },
    {
      duration: 0.4,
      delay: index * 0.1,
      easing: "ease-out",
    }
  );
}

// Loading button animation
function toggleLoadingButton(button, isLoading) {
  if (!animate || !button) return;

  const buttonText = button.querySelector("span");
  const loader = button.querySelector(".button-loader");
  if (!buttonText || !loader) return;

  if (isLoading) {
    buttonText.style.display = "none";
    loader.style.display = "block";
  } else {
    loader.style.display = "none";
    buttonText.style.display = "block";
  }
}

// Course card animations
function animateCourseCards() {
  if (!animate) return;

  const cards = document.querySelectorAll(".course-card");
  cards.forEach((card, index) => {
    animate(
      card,
      {
        scale: [0.9, 1],
        opacity: [0, 1],
      },
      {
        duration: 0.4,
        delay: 0.2 + index * 0.1,
        easing: [0.6, -0.05, 0.01, 0.99],
      }
    );
  });
}

// Notification animation
function showNotification(message, type = "success") {
  const notificationContainer = document.getElementById(
    "notificationContainer"
  );
  if (!notificationContainer) return;

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notificationContainer.appendChild(notification);

  if (animate) {
    animate(
      notification,
      {
        x: [100, 0],
        opacity: [0, 1],
      },
      {
        duration: 0.4,
        easing: "ease-out",
      }
    );

    setTimeout(() => {
      animate(
        notification,
        {
          x: [0, 100],
          opacity: [1, 0],
        },
        {
          duration: 0.4,
          easing: "ease-in",
        }
      ).then(() => {
        notification.remove();
      });
    }, 3000);
  } else {
    // Fallback without animations
    setTimeout(() => notification.remove(), 3000);
  }
}

// Dashboard animations
function animateDashboard() {
  if (!animate) return;

  const navButtons = document.querySelectorAll(".nav-button");
  navButtons.forEach((button, index) => {
    animate(
      button,
      {
        x: [-20, 0],
        opacity: [0, 1],
      },
      {
        duration: 0.4,
        delay: 0.2 + index * 0.1,
        easing: "ease-out",
      }
    );
  });
}

// Update window.appAnimations with our functions
Object.assign(window.appAnimations, {
  animateFormField,
  toggleLoadingButton,
  animateCourseCards,
  showNotification,
  animateDashboard,
});

// Initialize animations when document is ready
document.addEventListener("DOMContentLoaded", () => {
  if (!animate) {
    console.warn("Motion library not loaded. Animations will be disabled.");
    return;
  }

  const loginContainer = document.querySelector(".login-container");
  if (loginContainer) {
    animate(
      loginContainer,
      {
        scale: [0.9, 1],
        opacity: [0, 1],
      },
      {
        duration: 0.6,
        easing: [0.6, -0.05, 0.01, 0.99],
      }
    );

    // Logo animation
    const logoCheck = document.querySelector(".logo-check");
    if (logoCheck) {
      animate(
        logoCheck,
        {
          pathLength: [0, 1],
        },
        {
          duration: 0.8,
          delay: 0.4,
          easing: "ease-in-out",
        }
      );
    }

    // Input animations
    const inputs = document.querySelectorAll(".input-group input");
    inputs.forEach((input, index) => {
      animate(
        input,
        {
          x: [-20, 0],
          opacity: [0, 1],
        },
        {
          duration: 0.4,
          delay: 0.3 + index * 0.1,
          easing: "ease-out",
        }
      );
    });
  }
});
